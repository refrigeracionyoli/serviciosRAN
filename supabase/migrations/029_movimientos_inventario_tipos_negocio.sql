-- Tipos semanticos para la trazabilidad de inventario.
-- Mantiene entrada/salida/ajuste para movimientos manuales y separa los eventos automaticos.

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.movimientos_inventario'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table public.movimientos_inventario drop constraint %I', v_constraint_name);
  end loop;
end;
$$;

update public.movimientos_inventario
set tipo = 'alta_inventario'
where tipo = 'entrada'
  and motivo ilike 'Alta inicial de inventario';

update public.movimientos_inventario
set tipo = 'instalacion_refaccion'
where tipo = 'salida'
  and motivo ilike '%Instalacion a%';

update public.movimientos_inventario
set tipo = 'correccion_instalacion'
where tipo in ('entrada', 'reversion_instalacion')
  and (
    tipo = 'reversion_instalacion'
    or motivo ilike '%Reversion de instalacion%'
    or motivo ilike '%Correccion de Instalacion%'
  );

update public.movimientos_inventario
set tipo = 'asignacion_tecnico'
where tipo = 'salida'
  and motivo ilike '%Movimiento a inventario de tecnico%';

update public.movimientos_inventario
set tipo = 'devolucion_tecnico'
where tipo = 'entrada'
  and (
    motivo ilike '%Devolucion de inventario de tecnico%'
    or motivo ilike '%Devolucion automatica de inventario de tecnico%'
    or motivo ilike '%Eliminacion de inventario de tecnico%'
  );

alter table public.movimientos_inventario
  add constraint movimientos_inventario_tipo_check
  check (
    tipo in (
      'entrada',
      'salida',
      'ajuste',
      'alta_inventario',
      'asignacion_tecnico',
      'devolucion_tecnico',
      'instalacion_refaccion',
      'correccion_instalacion'
    )
  );

create or replace function public.sync_inventario_from_servicio_refacciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_key text;
  v_referencia_id bigint;
  v_ubicacion text;
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if tg_op = 'UPDATE'
    and old.inventario_id is not distinct from new.inventario_id
    and old.cantidad = new.cantidad
    and old.servicio_id is not distinct from new.servicio_id
    and old.mantenimiento_id is not distinct from new.mantenimiento_id
    and coalesce(old.inventory_source, 'general') = coalesce(new.inventory_source, 'general')
  then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE')
    and old.inventario_id is not null
    and coalesce(old.inventory_source, 'general') = 'general'
  then
    update public.inventario
    set stock_actual = stock_actual + old.cantidad
    where id = old.inventario_id;

    select ref_key, referencia_id, ubicacion
    into v_ref_key, v_referencia_id, v_ubicacion
    from public._build_refaccion_context(old.servicio_id, old.mantenimiento_id);

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      old.inventario_id,
      'correccion_instalacion',
      old.cantidad,
      format('%s Correccion de Instalacion a %s', v_ref_key, v_ubicacion),
      v_referencia_id,
      v_user_id
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.inventario_id is not null
    and coalesce(new.inventory_source, 'general') = 'general'
  then
    update public.inventario
    set stock_actual = stock_actual - new.cantidad
    where id = new.inventario_id
      and stock_actual >= new.cantidad;

    if not found then
      raise exception 'Stock insuficiente para inventario_id=% (cantidad solicitada=%).',
        new.inventario_id,
        new.cantidad;
    end if;

    select ref_key, referencia_id, ubicacion
    into v_ref_key, v_referencia_id, v_ubicacion
    from public._build_refaccion_context(new.servicio_id, new.mantenimiento_id);

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      new.inventario_id,
      'instalacion_refaccion',
      new.cantidad,
      format('%s Instalacion a %s', v_ref_key, v_ubicacion),
      v_referencia_id,
      v_user_id
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.upsert_inventario_tecnico_manual(
  p_tecnico_id uuid,
  p_inventario_id bigint,
  p_cantidad integer,
  p_fecha date
)
returns table (
  id bigint,
  tecnico_id uuid,
  inventario_id bigint,
  cantidad integer,
  fecha date,
  next_stock integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor_role text;
  v_existing public.inventario_tecnico%rowtype;
  v_saved public.inventario_tecnico%rowtype;
  v_delta integer := 0;
  v_current_stock integer;
  v_next_stock integer;
  v_tecnico_nombre text;
  v_item_nombre text;
  v_previous_active_quantity integer := 0;
  v_previous_assigned_total integer := 0;
  v_next_assigned_total integer := 0;
begin
  select role
  into v_actor_role
  from public.profiles
  where profiles.id = auth.uid();

  if auth.uid() is null or (coalesce(v_actor_role, '') <> 'admin' and auth.uid() <> p_tecnico_id) then
    raise exception 'No autorizado para actualizar inventario técnico.';
  end if;

  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0.';
  end if;

  select *
  into v_existing
  from public.inventario_tecnico
  where inventario_tecnico.tecnico_id = p_tecnico_id
    and inventario_tecnico.inventario_id = p_inventario_id
    and inventario_tecnico.fecha = p_fecha;

  if v_existing.id is not null and v_existing.devuelto_at is null then
    v_previous_active_quantity := greatest(coalesce(v_existing.cantidad, 0), 0);
  end if;

  v_previous_assigned_total := greatest(
    coalesce(v_existing.cantidad_asignada_total, 0),
    coalesce(v_existing.cantidad, 0),
    0
  );

  v_delta := p_cantidad - v_previous_active_quantity;

  select inventario.stock_actual, coalesce(inventario.nombre, format('Item %s', p_inventario_id))
  into v_current_stock, v_item_nombre
  from public.inventario
  where inventario.id = p_inventario_id;

  if v_current_stock is null then
    raise exception 'No se encontró el inventario solicitado.';
  end if;

  if v_delta > 0 and v_current_stock < v_delta then
    raise exception 'Stock insuficiente para asignar. Disponible: %.', v_current_stock;
  end if;

  if v_delta > 0 then
    update public.inventario
    set stock_actual = stock_actual - v_delta
    where inventario.id = p_inventario_id
      and stock_actual >= v_delta;

    if not found then
      raise exception 'Stock insuficiente para asignar. Disponible: %.', v_current_stock;
    end if;
  elsif v_delta < 0 then
    update public.inventario
    set stock_actual = stock_actual + abs(v_delta)
    where inventario.id = p_inventario_id;
  end if;

  v_next_stock := case
    when v_delta > 0 then v_current_stock - v_delta
    when v_delta < 0 then v_current_stock + abs(v_delta)
    else v_current_stock
  end;

  v_next_assigned_total := case
    when v_existing.id is null then p_cantidad
    when v_existing.devuelto_at is not null then v_previous_assigned_total + p_cantidad
    when v_delta > 0 then v_previous_assigned_total + v_delta
    else v_previous_assigned_total
  end;

  insert into public.inventario_tecnico (
    tecnico_id,
    inventario_id,
    cantidad,
    cantidad_asignada_total,
    fecha,
    devuelto_at,
    devuelto_automaticamente
  )
  values (
    p_tecnico_id,
    p_inventario_id,
    p_cantidad,
    v_next_assigned_total,
    p_fecha,
    null,
    false
  )
  on conflict (tecnico_id, inventario_id, fecha)
  do update set
    cantidad = excluded.cantidad,
    cantidad_asignada_total = v_next_assigned_total,
    devuelto_at = null,
    devuelto_automaticamente = false
  returning * into v_saved;

  if v_delta <> 0 then
    select coalesce(profiles.nombre, p_tecnico_id::text)
    into v_tecnico_nombre
    from public.profiles
    where profiles.id = p_tecnico_id;

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      p_inventario_id,
      case when v_delta > 0 then 'asignacion_tecnico' else 'devolucion_tecnico' end,
      abs(v_delta),
      format(
        '[INV_TECNICO:%s] %s: %s | %s | %s',
        v_saved.id,
        case
          when v_delta > 0 then 'Movimiento a inventario de tecnico'
          else 'Devolucion de inventario de tecnico'
        end,
        coalesce(v_tecnico_nombre, p_tecnico_id::text),
        coalesce(v_item_nombre, format('Item %s', p_inventario_id)),
        p_fecha
      ),
      v_saved.id,
      auth.uid()
    );
  end if;

  return query
  select
    v_saved.id,
    v_saved.tecnico_id,
    v_saved.inventario_id,
    v_saved.cantidad,
    v_saved.fecha,
    v_next_stock;
end;
$$;

create or replace function public.delete_inventario_tecnico_manual(
  p_row_id bigint,
  p_automatic boolean default false
)
returns table (
  id bigint,
  tecnico_id uuid,
  inventario_id bigint,
  cantidad integer,
  fecha date,
  next_stock integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor_role text;
  v_row public.inventario_tecnico%rowtype;
  v_saved public.inventario_tecnico%rowtype;
  v_current_stock integer;
  v_next_stock integer;
  v_tecnico_nombre text;
  v_item_nombre text;
  v_cantidad_a_devolver integer := 0;
begin
  select *
  into v_row
  from public.inventario_tecnico
  where inventario_tecnico.id = p_row_id;

  if v_row.id is null then
    raise exception 'No se encontró el registro de inventario técnico.';
  end if;

  select role
  into v_actor_role
  from public.profiles
  where profiles.id = auth.uid();

  if auth.uid() is null or (coalesce(v_actor_role, '') <> 'admin' and auth.uid() <> v_row.tecnico_id) then
    raise exception 'No autorizado para eliminar inventario técnico.';
  end if;

  select inventario.stock_actual, coalesce(inventario.nombre, format('Item %s', v_row.inventario_id))
  into v_current_stock, v_item_nombre
  from public.inventario
  where inventario.id = v_row.inventario_id;

  if v_current_stock is null then
    raise exception 'No se encontró el inventario solicitado.';
  end if;

  if v_row.devuelto_at is not null or coalesce(v_row.cantidad, 0) <= 0 then
    return query
    select
      v_row.id,
      v_row.tecnico_id,
      v_row.inventario_id,
      greatest(coalesce(v_row.cantidad, 0), 0),
      v_row.fecha,
      v_current_stock;
    return;
  end if;

  v_cantidad_a_devolver := greatest(coalesce(v_row.cantidad, 0), 0);
  v_next_stock := v_current_stock + v_cantidad_a_devolver;

  update public.inventario
  set stock_actual = v_next_stock
  where inventario.id = v_row.inventario_id;

  update public.inventario_tecnico
  set cantidad = 0,
      devuelto_at = now(),
      devuelto_automaticamente = coalesce(p_automatic, false)
  where inventario_tecnico.id = v_row.id
  returning * into v_saved;

  select coalesce(profiles.nombre, v_row.tecnico_id::text)
  into v_tecnico_nombre
  from public.profiles
  where profiles.id = v_row.tecnico_id;

  insert into public.movimientos_inventario (
    inventario_id,
    tipo,
    cantidad,
    motivo,
    referencia_id,
    usuario_id
  )
  values (
    v_row.inventario_id,
    'devolucion_tecnico',
    v_cantidad_a_devolver,
    format(
      '[INV_TECNICO:%s] %s: %s | %s | %s',
      v_row.id,
      case
        when coalesce(p_automatic, false) then 'Devolucion automatica de inventario de tecnico por cambio de dia'
        else 'Eliminacion de inventario de tecnico'
      end,
      coalesce(v_tecnico_nombre, v_row.tecnico_id::text),
      coalesce(v_item_nombre, format('Item %s', v_row.inventario_id)),
      v_row.fecha
    ),
    v_row.id,
    auth.uid()
  );

  return query
  select
    v_saved.id,
    v_saved.tecnico_id,
    v_saved.inventario_id,
    v_saved.cantidad,
    v_saved.fecha,
    v_next_stock;
end;
$$;

grant execute on function public.upsert_inventario_tecnico_manual(uuid, bigint, integer, date) to authenticated;
grant execute on function public.delete_inventario_tecnico_manual(bigint, boolean) to authenticated;
