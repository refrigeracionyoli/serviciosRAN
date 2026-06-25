-- Make workshop lifecycle matching accent-insensitive for future service
-- status changes. Existing workshop records are left untouched.

create or replace function public.normalize_workshop_service_type(p_value text)
returns text
language sql
immutable
as $$
  select translate(
    upper(coalesce(p_value, '')),
    'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
    'AAAAAEEEEIIIIOOOOOUUUUN'
  );
$$;

create or replace function public.sync_maquinas_taller_from_servicios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := public.normalize_workshop_service_type(new.tipo_servicio);
  v_fecha date := coalesce(new.fecha_servicio, current_date);
  v_user_id uuid := auth.uid();
  v_open_id bigint;
  v_open_cliente_id bigint;
  v_existing_mov bigint;
  v_destino text;
begin
  if new.maquina_id is null then
    return new;
  end if;

  if new.status not in ('completado', 'cerrado') then
    return new;
  end if;

  if old.status in ('completado', 'cerrado')
     and not (old.status = 'completado' and new.status = 'cerrado') then
    return new;
  end if;

  if v_tipo like '%URBAN%' then
    select id
    into v_existing_mov
    from public.maquinas_taller_movimientos
    where servicio_id = new.id
      and accion = 'salida'
      and motivo = 'urban'
    limit 1;

    if v_existing_mov is not null then
      return new;
    end if;

    select id, cliente_id
    into v_open_id, v_open_cliente_id
    from public.maquinas_en_taller
    where maquina_id = new.maquina_id
      and fecha_salida is null
    order by fecha_entrada desc, id desc
    limit 1;

    if v_open_id is null then
      insert into public.maquinas_en_taller (
        maquina_id,
        cliente_id,
        servicio_id,
        orden,
        fecha_entrada,
        fecha_salida,
        diagnostico,
        status
      )
      values (
        new.maquina_id,
        new.cliente_id,
        new.id,
        new.orden,
        v_fecha,
        v_fecha,
        coalesce(new.descripcion, format('Salida a Urban por servicio #%s', new.id)),
        'devuelta'
      )
      returning id into v_open_id;
    else
      update public.maquinas_en_taller
      set
        fecha_salida = coalesce(fecha_salida, v_fecha),
        status = 'devuelta',
        servicio_id = coalesce(servicio_id, new.id),
        diagnostico = coalesce(diagnostico, new.descripcion)
      where id = v_open_id;
    end if;

    update public.maquinas
      set status = 'baja'
    where id = new.maquina_id;

    insert into public.maquinas_taller_movimientos (
      maquina_id,
      maquina_taller_id,
      servicio_id,
      orden_servicio,
      accion,
      motivo,
      origen,
      destino,
      detalle,
      fecha_movimiento,
      usuario_id
    )
    values (
      new.maquina_id,
      v_open_id,
      new.id,
      new.orden,
      'salida',
      'urban',
      case when v_open_id is null then 'externo' else 'taller' end,
      'URBAN',
      coalesce(new.descripcion, format('Salida automatica a Urban por servicio #%s', new.id)),
      v_fecha,
      v_user_id
    );

    return new;
  end if;

  if v_tipo like '%RETIRO%' then
    select id
    into v_existing_mov
    from public.maquinas_taller_movimientos
    where servicio_id = new.id
      and accion = 'entrada'
      and motivo = 'retiro'
    limit 1;

    if v_existing_mov is not null then
      return new;
    end if;

    select id
    into v_open_id
    from public.maquinas_en_taller
    where maquina_id = new.maquina_id
      and fecha_salida is null
    order by fecha_entrada desc, id desc
    limit 1;

    if v_open_id is null then
      insert into public.maquinas_en_taller (
        maquina_id,
        cliente_id,
        servicio_id,
        orden,
        fecha_entrada,
        diagnostico,
        status
      )
      values (
        new.maquina_id,
        new.cliente_id,
        new.id,
        new.orden,
        v_fecha,
        coalesce(new.descripcion, format('Ingreso por retiro de servicio #%s', new.id)),
        'en_taller'
      )
      returning id into v_open_id;
    else
      update public.maquinas_en_taller
      set
        servicio_id = coalesce(servicio_id, new.id),
        orden = coalesce(orden, new.orden),
        diagnostico = coalesce(diagnostico, new.descripcion),
        status = 'en_taller'
      where id = v_open_id;
    end if;

    update public.maquinas
      set
        status = 'en_taller',
        cliente_id = null
    where id = new.maquina_id;

    insert into public.maquinas_taller_movimientos (
      maquina_id,
      maquina_taller_id,
      servicio_id,
      orden_servicio,
      accion,
      motivo,
      origen,
      destino,
      detalle,
      fecha_movimiento,
      usuario_id
    )
    values (
      new.maquina_id,
      v_open_id,
      new.id,
      new.orden,
      'entrada',
      'retiro',
      'cliente',
      'taller',
      coalesce(new.descripcion, format('Entrada automatica por retiro #%s', new.id)),
      v_fecha,
      v_user_id
    );

    return new;
  end if;

  if v_tipo like '%INSTALACION%' then
    select id
    into v_existing_mov
    from public.maquinas_taller_movimientos
    where servicio_id = new.id
      and accion = 'salida'
      and motivo = 'instalacion'
    limit 1;

    if v_existing_mov is not null then
      return new;
    end if;

    select id, cliente_id
    into v_open_id, v_open_cliente_id
    from public.maquinas_en_taller
    where maquina_id = new.maquina_id
      and fecha_salida is null
    order by fecha_entrada desc, id desc
    limit 1;

    if v_open_id is not null then
      update public.maquinas_en_taller
      set
        fecha_salida = coalesce(fecha_salida, v_fecha),
        status = 'devuelta',
        servicio_id = coalesce(servicio_id, new.id),
        diagnostico = coalesce(diagnostico, new.descripcion)
      where id = v_open_id;
    end if;

    update public.maquinas
      set
        status = 'operando',
        cliente_id = coalesce(new.cliente_id, cliente_id),
        fecha_instalacion = coalesce(new.fecha_servicio, fecha_instalacion)
      where id = new.maquina_id;

    v_destino := case
      when new.cliente_id is null then 'cliente'
      else format('cliente:%s', new.cliente_id)
    end;

    insert into public.maquinas_taller_movimientos (
      maquina_id,
      maquina_taller_id,
      servicio_id,
      orden_servicio,
      accion,
      motivo,
      origen,
      destino,
      detalle,
      fecha_movimiento,
      usuario_id
    )
    values (
      new.maquina_id,
      v_open_id,
      new.id,
      new.orden,
      'salida',
      'instalacion',
      case when v_open_id is null then 'externo' else 'taller' end,
      v_destino,
      coalesce(new.descripcion, format('Salida automatica por instalacion #%s', new.id)),
      v_fecha,
      v_user_id
    );

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_servicios_sync_maquinas_taller
  on public.servicios;

create trigger trg_servicios_sync_maquinas_taller
  after update of status
  on public.servicios
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_maquinas_taller_from_servicios();
