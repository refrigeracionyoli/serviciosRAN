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
  v_delta integer;
  v_current_stock integer;
  v_tecnico_nombre text;
  v_item_nombre text;
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

  v_delta := p_cantidad - coalesce(v_existing.cantidad, 0);

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

  insert into public.inventario_tecnico (
    tecnico_id,
    inventario_id,
    cantidad,
    fecha
  )
  values (
    p_tecnico_id,
    p_inventario_id,
    p_cantidad,
    p_fecha
  )
  on conflict (tecnico_id, inventario_id, fecha)
  do update set cantidad = excluded.cantidad
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
    case
      when v_delta > 0 then v_current_stock - v_delta
      when v_delta < 0 then v_current_stock + abs(v_delta)
      else v_current_stock
    end;
end;
$$;

create or replace function public.delete_inventario_tecnico_manual(
  p_row_id bigint
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
  v_current_stock integer;
  v_tecnico_nombre text;
  v_item_nombre text;
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

  update public.inventario
  set stock_actual = stock_actual + v_row.cantidad
  where inventario.id = v_row.inventario_id;

  delete from public.inventario_tecnico
  where inventario_tecnico.id = v_row.id;

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
    v_row.cantidad,
    format(
      '[INV_TECNICO:%s] Eliminacion de inventario de tecnico: %s | %s | %s',
      v_row.id,
      coalesce(v_tecnico_nombre, v_row.tecnico_id::text),
      coalesce(v_item_nombre, format('Item %s', v_row.inventario_id)),
      v_row.fecha
    ),
    v_row.id,
    auth.uid()
  );

  return query
  select
    v_row.id,
    v_row.tecnico_id,
    v_row.inventario_id,
    v_row.cantidad,
    v_row.fecha,
    v_current_stock + v_row.cantidad;
end;
$$;

grant execute on function public.upsert_inventario_tecnico_manual(uuid, bigint, integer, date) to authenticated;
grant execute on function public.delete_inventario_tecnico_manual(bigint) to authenticated;
