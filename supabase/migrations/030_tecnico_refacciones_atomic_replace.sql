-- Reemplazo atómico e idempotente de refacciones registradas desde inventario técnico.

with duplicate_groups as (
  select
    servicio_id,
    inventario_id,
    min(id) as keep_id,
    sum(cantidad)::integer as total_cantidad,
    max(nombre_refaccion) as nombre_refaccion,
    max(precio_unitario) as precio_unitario
  from public.servicio_refacciones
  where servicio_id is not null
    and inventory_source = 'tecnico'
    and inventario_id is not null
  group by servicio_id, inventario_id
  having count(*) > 1
),
updated_groups as (
  update public.servicio_refacciones sr
  set
    cantidad = dg.total_cantidad,
    nombre_refaccion = dg.nombre_refaccion,
    precio_unitario = dg.precio_unitario,
    inventory_source = 'tecnico'
  from duplicate_groups dg
  where sr.id = dg.keep_id
  returning sr.id
)
delete from public.servicio_refacciones sr
using duplicate_groups dg, updated_groups ug
where sr.servicio_id = dg.servicio_id
  and sr.inventario_id = dg.inventario_id
  and sr.inventory_source = 'tecnico'
  and ug.id = dg.keep_id
  and sr.id <> dg.keep_id;

create unique index if not exists servicio_refacciones_tecnico_unique
  on public.servicio_refacciones (servicio_id, inventory_source, inventario_id)
  where servicio_id is not null
    and inventory_source = 'tecnico'
    and inventario_id is not null;

drop function if exists public.replace_servicio_refacciones_tecnico(bigint, uuid, date, jsonb);

create or replace function public.replace_servicio_refacciones_tecnico(
  p_servicio_id bigint,
  p_tecnico_id uuid,
  p_fecha date,
  p_items jsonb
)
returns table (
  id bigint,
  servicio_id bigint,
  mantenimiento_id bigint,
  inventario_id bigint,
  nombre_refaccion text,
  cantidad integer,
  precio_unitario numeric,
  subtotal numeric,
  inventory_source text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_servicio public.servicios%rowtype;
  v_fecha date;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_refaccion record;
  v_inventario_tecnico public.inventario_tecnico%rowtype;
  v_current_cantidad integer;
  v_previous_cantidad integer;
  v_next_cantidad integer;
  v_next_disponible integer;
  v_assigned_total integer;
  v_item_nombre text;
  v_total_refacciones numeric(10,2) := 0;
begin
  if v_actor_id is null then
    raise exception 'No hay sesión activa para registrar refacciones.';
  end if;

  select role
  into v_actor_role
  from public.profiles
  where profiles.id = v_actor_id;

  select *
  into v_servicio
  from public.servicios
  where servicios.id = p_servicio_id
  for update;

  if v_servicio.id is null then
    raise exception 'No se encontró el servicio.';
  end if;

  if coalesce(v_actor_role, '') <> 'admin' and v_actor_id <> v_servicio.tecnico_id then
    raise exception 'No autorizado para registrar refacciones en este servicio.';
  end if;

  if p_tecnico_id is null or v_servicio.tecnico_id is distinct from p_tecnico_id then
    raise exception 'El técnico seleccionado no coincide con el servicio.';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Las refacciones deben enviarse como una lista.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_items) as item(
      inventario_id bigint,
      nombre_refaccion text,
      cantidad integer,
      precio_unitario numeric
    )
    where item.inventario_id is null
      or nullif(btrim(coalesce(item.nombre_refaccion, '')), '') is null
      or item.cantidad is null
      or item.cantidad <= 0
      or item.precio_unitario is null
      or item.precio_unitario < 0
  ) then
    raise exception 'Revisa las refacciones capturadas antes de guardar.';
  end if;

  v_fecha := coalesce(p_fecha, v_servicio.fecha_servicio, current_date);

  create temporary table if not exists pg_temp.next_servicio_refacciones_tecnico (
    inventario_id bigint primary key,
    nombre_refaccion text not null,
    cantidad integer not null,
    precio_unitario numeric(10,2) not null
  ) on commit drop;

  create temporary table if not exists pg_temp.previous_servicio_refacciones_tecnico (
    inventario_id bigint primary key,
    cantidad integer not null
  ) on commit drop;

  truncate table pg_temp.next_servicio_refacciones_tecnico;
  truncate table pg_temp.previous_servicio_refacciones_tecnico;

  insert into pg_temp.next_servicio_refacciones_tecnico (
    inventario_id,
    nombre_refaccion,
    cantidad,
    precio_unitario
  )
  select
    item.inventario_id,
    max(nullif(btrim(item.nombre_refaccion), '')) as nombre_refaccion,
    sum(item.cantidad)::integer as cantidad,
    max(item.precio_unitario)::numeric(10,2) as precio_unitario
  from jsonb_to_recordset(v_items) as item(
    inventario_id bigint,
    nombre_refaccion text,
    cantidad integer,
    precio_unitario numeric
  )
  group by item.inventario_id;

  insert into pg_temp.previous_servicio_refacciones_tecnico (
    inventario_id,
    cantidad
  )
  select
    servicio_refacciones.inventario_id,
    sum(servicio_refacciones.cantidad)::integer
  from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id
    and servicio_refacciones.inventory_source = 'tecnico'
    and servicio_refacciones.inventario_id is not null
  group by servicio_refacciones.inventario_id;

  for v_refaccion in
    select
      coalesce(previous_rows.inventario_id, next_rows.inventario_id) as inventario_id,
      coalesce(previous_rows.cantidad, 0) as previous_cantidad,
      coalesce(next_rows.cantidad, 0) as next_cantidad
    from pg_temp.previous_servicio_refacciones_tecnico previous_rows
    full outer join pg_temp.next_servicio_refacciones_tecnico next_rows
      on next_rows.inventario_id = previous_rows.inventario_id
  loop
    select *
    into v_inventario_tecnico
    from public.inventario_tecnico
    where inventario_tecnico.tecnico_id = p_tecnico_id
      and inventario_tecnico.inventario_id = v_refaccion.inventario_id
      and inventario_tecnico.fecha = v_fecha
    for update;

    v_current_cantidad := coalesce(v_inventario_tecnico.cantidad, 0);
    v_previous_cantidad := coalesce(v_refaccion.previous_cantidad, 0);
    v_next_cantidad := coalesce(v_refaccion.next_cantidad, 0);
    v_next_disponible := v_current_cantidad + v_previous_cantidad - v_next_cantidad;

    if v_next_disponible < 0 then
      select coalesce(inventario.nombre, format('Item %s', v_refaccion.inventario_id))
      into v_item_nombre
      from public.inventario
      where inventario.id = v_refaccion.inventario_id;

      raise exception 'Inventario técnico insuficiente para %. Disponible: %.',
        coalesce(v_item_nombre, format('Item %s', v_refaccion.inventario_id)),
        v_current_cantidad + v_previous_cantidad;
    end if;

    if v_inventario_tecnico.id is null and v_next_disponible = 0 then
      continue;
    end if;

    v_assigned_total := case
      when v_inventario_tecnico.id is null then v_next_disponible
      else greatest(
        coalesce(v_inventario_tecnico.cantidad_asignada_total, 0),
        coalesce(v_inventario_tecnico.cantidad, 0),
        v_next_disponible
      )
    end;

    if v_inventario_tecnico.id is null then
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
        v_refaccion.inventario_id,
        v_next_disponible,
        v_assigned_total,
        v_fecha,
        null,
        false
      );
    else
      update public.inventario_tecnico
      set
        cantidad = v_next_disponible,
        cantidad_asignada_total = v_assigned_total,
        devuelto_at = null,
        devuelto_automaticamente = false
      where inventario_tecnico.id = v_inventario_tecnico.id;
    end if;
  end loop;

  delete from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id
    and servicio_refacciones.inventory_source = 'tecnico';

  insert into public.servicio_refacciones (
    servicio_id,
    inventario_id,
    nombre_refaccion,
    cantidad,
    precio_unitario,
    inventory_source
  )
  select
    p_servicio_id,
    next_rows.inventario_id,
    next_rows.nombre_refaccion,
    next_rows.cantidad,
    next_rows.precio_unitario,
    'tecnico'
  from pg_temp.next_servicio_refacciones_tecnico next_rows
  order by next_rows.nombre_refaccion;

  select coalesce(sum(servicio_refacciones.cantidad * servicio_refacciones.precio_unitario), 0)::numeric(10,2)
  into v_total_refacciones
  from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id;

  update public.servicios
  set
    costo_refacciones = v_total_refacciones,
    updated_at = now()
  where servicios.id = p_servicio_id;

  return query
  select
    servicio_refacciones.id,
    servicio_refacciones.servicio_id,
    servicio_refacciones.mantenimiento_id,
    servicio_refacciones.inventario_id,
    servicio_refacciones.nombre_refaccion,
    servicio_refacciones.cantidad,
    servicio_refacciones.precio_unitario,
    servicio_refacciones.subtotal,
    servicio_refacciones.inventory_source
  from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id
  order by servicio_refacciones.id;
end;
$$;

grant execute on function public.replace_servicio_refacciones_tecnico(bigint, uuid, date, jsonb) to authenticated;
