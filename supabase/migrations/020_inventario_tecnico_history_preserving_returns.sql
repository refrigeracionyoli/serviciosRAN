alter table public.inventario_tecnico
  add column if not exists cantidad_asignada_total integer not null default 0,
  add column if not exists devuelto_at timestamptz,
  add column if not exists devuelto_automaticamente boolean not null default false;

update public.inventario_tecnico
set cantidad_asignada_total = greatest(coalesce(cantidad_asignada_total, 0), coalesce(cantidad, 0), 0)
where coalesce(cantidad_asignada_total, 0) <> greatest(coalesce(cantidad_asignada_total, 0), coalesce(cantidad, 0), 0);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventario_tecnico'::regclass
      and conname = 'inventario_tecnico_cantidad_check'
  ) then
    alter table public.inventario_tecnico
      drop constraint inventario_tecnico_cantidad_check;
  end if;
end
$$;

alter table public.inventario_tecnico
  add constraint inventario_tecnico_cantidad_check
  check (cantidad >= 0);

drop function if exists public.upsert_inventario_tecnico_manual(uuid, bigint, integer, date);

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
      case when v_delta > 0 then 'salida' else 'entrada' end,
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

drop function if exists public.delete_inventario_tecnico_manual(bigint);
drop function if exists public.delete_inventario_tecnico_manual(bigint, boolean);

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
    'entrada',
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
