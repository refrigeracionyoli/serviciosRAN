-- Movimientos automaticos de inventario al registrar/refinar refacciones en servicios y mantenimientos.
-- Regla: no hay captura manual de movimientos para instalaciones.

create or replace function public._build_refaccion_context(
  p_servicio_id bigint,
  p_mantenimiento_id bigint
)
returns table (
  ref_key text,
  referencia_id bigint,
  ubicacion text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_nombre text;
  v_direccion text;
  v_municipio text;
  v_modelo text;
  v_serie text;
begin
  if p_servicio_id is not null then
    select
      c.codigo_cliente,
      c.nombre,
      c.direccion,
      c.municipio,
      m.modelo,
      m.serie
    into
      v_codigo,
      v_nombre,
      v_direccion,
      v_municipio,
      v_modelo,
      v_serie
    from public.servicios s
    left join public.clientes c on c.id = s.cliente_id
    left join public.maquinas m on m.id = s.maquina_id
    where s.id = p_servicio_id;

    return query
    select
      format('[SERVICIO:%s]', p_servicio_id),
      p_servicio_id,
      format(
        '%s | %s | %s | %s | %s %s',
        coalesce(v_codigo, 'SIN_CODIGO'),
        coalesce(v_nombre, 'SIN_ESTABLECIMIENTO'),
        coalesce(v_direccion, 'SIN_DIRECCION'),
        coalesce(v_municipio, 'SIN_MUNICIPIO'),
        coalesce(v_modelo, ''),
        coalesce(v_serie, '')
      );

    return;
  end if;

  if p_mantenimiento_id is not null then
    select
      c.codigo_cliente,
      c.nombre,
      c.direccion,
      c.municipio,
      m.modelo,
      m.serie
    into
      v_codigo,
      v_nombre,
      v_direccion,
      v_municipio,
      v_modelo,
      v_serie
    from public.mantenimientos_poliza mp
    left join public.clientes c on c.id = mp.cliente_id
    left join public.maquinas m on m.id = mp.maquina_id
    where mp.id = p_mantenimiento_id;

    return query
    select
      format('[MTTO:%s]', p_mantenimiento_id),
      p_mantenimiento_id,
      format(
        '%s | %s | %s | %s | %s %s',
        coalesce(v_codigo, 'SIN_CODIGO'),
        coalesce(v_nombre, 'SIN_ESTABLECIMIENTO'),
        coalesce(v_direccion, 'SIN_DIRECCION'),
        coalesce(v_municipio, 'SIN_MUNICIPIO'),
        coalesce(v_modelo, ''),
        coalesce(v_serie, '')
      );

    return;
  end if;

  return query
  select '[REFACCION:0]'::text, null::bigint, 'SIN_REFERENCIA'::text;
end;
$$;

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
  then
    return new;
  end if;

  -- Reversa del registro anterior para UPDATE/DELETE.
  if tg_op in ('UPDATE', 'DELETE') and old.inventario_id is not null then
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
      'entrada',
      old.cantidad,
      format('%s Reversion de instalacion a %s', v_ref_key, v_ubicacion),
      v_referencia_id,
      v_user_id
    );
  end if;

  -- Consumo del registro nuevo para INSERT/UPDATE.
  if tg_op in ('INSERT', 'UPDATE') and new.inventario_id is not null then
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
      'salida',
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

drop trigger if exists trg_servicio_refacciones_sync_inventario
  on public.servicio_refacciones;

create trigger trg_servicio_refacciones_sync_inventario
  before insert or update or delete
  on public.servicio_refacciones
  for each row
  execute function public.sync_inventario_from_servicio_refacciones();
