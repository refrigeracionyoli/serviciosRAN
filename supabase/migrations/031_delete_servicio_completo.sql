create or replace function public.delete_servicio_completo(
  p_servicio_id bigint,
  p_dry_run boolean default false
)
returns table (
  servicio_id bigint,
  evidencias_count integer,
  refacciones_count integer,
  cierres_count integer
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
  v_refaccion record;
  v_inventario_tecnico public.inventario_tecnico%rowtype;
  v_fecha date;
  v_next_cantidad integer;
  v_assigned_total integer;
  v_item_nombre text;
  v_evidencias_count integer := 0;
  v_refacciones_count integer := 0;
  v_cierres_count integer := 0;
  v_deleted_services integer := 0;
begin
  if v_actor_id is null then
    raise exception 'No hay sesion activa para eliminar el servicio.';
  end if;

  select profiles.role
  into v_actor_role
  from public.profiles
  where profiles.id = v_actor_id;

  if coalesce(v_actor_role, '') <> 'admin' then
    raise exception 'Solo administradores pueden eliminar servicios.';
  end if;

  select *
  into v_servicio
  from public.servicios
  where servicios.id = p_servicio_id
  for update;

  if v_servicio.id is null then
    raise exception 'Servicio no encontrado.';
  end if;

  if v_servicio.tecnico_id is null and exists (
    select 1
    from public.servicio_refacciones
    where servicio_refacciones.servicio_id = p_servicio_id
      and coalesce(servicio_refacciones.inventory_source, 'general') = 'tecnico'
  ) then
    raise exception 'El servicio tiene refacciones de tecnico, pero no tiene tecnico asignado.';
  end if;

  v_fecha := coalesce(v_servicio.fecha_servicio, v_servicio.fecha_solicitud, current_date);

  select count(*)::integer
  into v_evidencias_count
  from public.evidencias
  where evidencias.servicio_id = p_servicio_id;

  select count(*)::integer
  into v_refacciones_count
  from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id;

  select count(*)::integer
  into v_cierres_count
  from public.cierres
  where cierres.servicio_id = p_servicio_id;

  if p_dry_run then
    return query
    select
      p_servicio_id,
      v_evidencias_count,
      v_refacciones_count,
      v_cierres_count;
    return;
  end if;

  for v_refaccion in
    select
      servicio_refacciones.inventario_id,
      sum(servicio_refacciones.cantidad)::integer as cantidad
    from public.servicio_refacciones
    where servicio_refacciones.servicio_id = p_servicio_id
      and coalesce(servicio_refacciones.inventory_source, 'general') = 'tecnico'
      and servicio_refacciones.inventario_id is not null
    group by servicio_refacciones.inventario_id
  loop
    select *
    into v_inventario_tecnico
    from public.inventario_tecnico
    where inventario_tecnico.tecnico_id = v_servicio.tecnico_id
      and inventario_tecnico.inventario_id = v_refaccion.inventario_id
      and inventario_tecnico.fecha = v_fecha
    for update;

    v_next_cantidad := coalesce(v_inventario_tecnico.cantidad, 0) + v_refaccion.cantidad;

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
        v_servicio.tecnico_id,
        v_refaccion.inventario_id,
        v_next_cantidad,
        v_next_cantidad,
        v_fecha,
        null,
        false
      );
    else
      v_assigned_total := greatest(
        coalesce(v_inventario_tecnico.cantidad_asignada_total, 0),
        coalesce(v_inventario_tecnico.cantidad, 0),
        v_next_cantidad
      );

      update public.inventario_tecnico
      set
        cantidad = v_next_cantidad,
        cantidad_asignada_total = v_assigned_total,
        devuelto_at = null,
        devuelto_automaticamente = false
      where inventario_tecnico.id = v_inventario_tecnico.id;
    end if;

    select inventario.nombre
    into v_item_nombre
    from public.inventario
    where inventario.id = v_refaccion.inventario_id;

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      v_refaccion.inventario_id,
      'devolucion_tecnico',
      v_refaccion.cantidad,
      format(
        '[SERVICIO:%s] Devolucion de refaccion por eliminacion de servicio: %s | %s',
        p_servicio_id,
        coalesce(v_item_nombre, format('Item %s', v_refaccion.inventario_id)),
        v_fecha
      ),
      p_servicio_id,
      v_actor_id
    );
  end loop;

  update public.maquinas_en_taller
  set servicio_id = null
  where maquinas_en_taller.servicio_id = p_servicio_id;

  update public.maquinas_taller_movimientos
  set servicio_id = null
  where maquinas_taller_movimientos.servicio_id = p_servicio_id;

  delete from public.cierres
  where cierres.servicio_id = p_servicio_id;
  get diagnostics v_cierres_count = row_count;

  delete from public.evidencias
  where evidencias.servicio_id = p_servicio_id;

  delete from public.servicio_refacciones
  where servicio_refacciones.servicio_id = p_servicio_id;
  get diagnostics v_refacciones_count = row_count;

  delete from public.servicios
  where servicios.id = p_servicio_id;
  get diagnostics v_deleted_services = row_count;

  if v_deleted_services <> 1 then
    raise exception 'No se pudo eliminar el servicio.';
  end if;

  return query
  select
    p_servicio_id,
    v_evidencias_count,
    v_refacciones_count,
    v_cierres_count;
end;
$$;

revoke all on function public.delete_servicio_completo(bigint, boolean) from public;
grant execute on function public.delete_servicio_completo(bigint, boolean) to authenticated;
