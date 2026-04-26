drop function if exists public.delete_inventario_tecnico_manual(bigint);

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
    v_row.id,
    v_row.tecnico_id,
    v_row.inventario_id,
    v_row.cantidad,
    v_row.fecha,
    v_current_stock + v_row.cantidad;
end;
$$;

grant execute on function public.delete_inventario_tecnico_manual(bigint, boolean) to authenticated;
