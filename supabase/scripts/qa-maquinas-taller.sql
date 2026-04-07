-- QA script: Maquinas en Taller
-- Objetivo:
-- 1) Probar automatizacion por servicios RETIRO/INSTALACION.
-- 2) Dejar una maquina lista para probar el boton "Registrar maquina" manual.
--
-- Ejecutar en Supabase SQL Editor.
-- Requiere migraciones con soporte de maquinas_taller_movimientos.

begin;

do $$
declare
  v_tag text := 'QA_TALLER_202604';

  v_tecnico uuid;

  v_cliente_origen bigint;
  v_cliente_destino bigint;

  v_maquina_auto bigint;
  v_maquina_open bigint;
  v_maquina_manual bigint;

  v_servicio_retiro_auto bigint;
  v_servicio_instalacion_auto bigint;
  v_servicio_retiro_open bigint;

  v_orden_base bigint := extract(epoch from clock_timestamp())::bigint;
begin
  select id
  into v_tecnico
  from public.profiles
  where role = 'tecnico'
    and activo = true
  order by created_at asc
  limit 1;

  if v_tecnico is null then
    raise exception 'No existe tecnico activo en profiles. Crea o activa uno antes de correr este script.';
  end if;

  -- Clientes QA
  insert into public.clientes (
    codigo_cliente,
    nombre,
    direccion,
    municipio,
    telefono,
    correo_contacto,
    activo
  )
  values (
    'QA-TALLER-ORIGEN-202604',
    'Cliente QA Taller Origen',
    'Av QA 101',
    'Monterrey',
    '8180001001',
    'qa-origen@serviciosran.local',
    true
  )
  on conflict (codigo_cliente) do update
  set
    nombre = excluded.nombre,
    direccion = excluded.direccion,
    municipio = excluded.municipio,
    telefono = excluded.telefono,
    correo_contacto = excluded.correo_contacto,
    activo = true
  returning id into v_cliente_origen;

  insert into public.clientes (
    codigo_cliente,
    nombre,
    direccion,
    municipio,
    telefono,
    correo_contacto,
    activo
  )
  values (
    'QA-TALLER-DESTINO-202604',
    'Cliente QA Taller Destino',
    'Av QA 202',
    'Guadalupe',
    '8180002002',
    'qa-destino@serviciosran.local',
    true
  )
  on conflict (codigo_cliente) do update
  set
    nombre = excluded.nombre,
    direccion = excluded.direccion,
    municipio = excluded.municipio,
    telefono = excluded.telefono,
    correo_contacto = excluded.correo_contacto,
    activo = true
  returning id into v_cliente_destino;

  -- Maquina para flujo automatico completo (RETIRO -> INSTALACION)
  insert into public.maquinas (
    serie,
    modelo,
    cliente_id,
    status,
    observaciones,
    activo
  )
  values (
    'QA-TALLER-AUTO-202604',
    'KM901',
    v_cliente_origen,
    'operando',
    v_tag,
    true
  )
  on conflict (serie) do update
  set
    modelo = excluded.modelo,
    cliente_id = excluded.cliente_id,
    status = 'operando',
    observaciones = excluded.observaciones,
    activo = true
  returning id into v_maquina_auto;

  -- Maquina para dejar registro abierto automatico (solo RETIRO)
  insert into public.maquinas (
    serie,
    modelo,
    cliente_id,
    status,
    observaciones,
    activo
  )
  values (
    'QA-TALLER-OPEN-202604',
    'MS1500',
    v_cliente_origen,
    'operando',
    v_tag,
    true
  )
  on conflict (serie) do update
  set
    modelo = excluded.modelo,
    cliente_id = excluded.cliente_id,
    status = 'operando',
    observaciones = excluded.observaciones,
    activo = true
  returning id into v_maquina_open;

  -- Maquina para probar boton manual "Registrar maquina"
  insert into public.maquinas (
    serie,
    modelo,
    cliente_id,
    status,
    observaciones,
    activo
  )
  values (
    'QA-TALLER-MANUAL-202604',
    'SD1002',
    v_cliente_origen,
    'operando',
    v_tag,
    true
  )
  on conflict (serie) do update
  set
    modelo = excluded.modelo,
    cliente_id = excluded.cliente_id,
    status = 'operando',
    observaciones = excluded.observaciones,
    activo = true
  returning id into v_maquina_manual;

  -- Limpiar registros abiertos previos para evitar choque de validacion
  update public.maquinas_en_taller
  set
    fecha_salida = current_date,
    status = 'devuelta'
  where maquina_id in (v_maquina_auto, v_maquina_open)
    and fecha_salida is null;

  -- 1) RETIRO (auto entrada a taller)
  insert into public.servicios (
    orden,
    aviso,
    clase_orden,
    tipo_servicio,
    cliente_id,
    maquina_id,
    tecnico_id,
    descripcion,
    fecha_solicitud,
    fecha_servicio,
    status,
    costo_refacciones,
    costo_mano_obra
  )
  values (
    v_orden_base + 10,
    v_orden_base + 10,
    'ZSM1',
    'RETIRO',
    v_cliente_origen,
    v_maquina_auto,
    v_tecnico,
    v_tag || ' RETIRO AUTO',
    current_date,
    current_date,
    'en_ruta',
    0,
    648
  )
  returning id into v_servicio_retiro_auto;

  update public.servicios
  set status = 'completado'
  where id = v_servicio_retiro_auto;

  -- 2) INSTALACION (auto salida de taller)
  insert into public.servicios (
    orden,
    aviso,
    clase_orden,
    tipo_servicio,
    cliente_id,
    maquina_id,
    tecnico_id,
    descripcion,
    fecha_solicitud,
    fecha_servicio,
    status,
    costo_refacciones,
    costo_mano_obra
  )
  values (
    v_orden_base + 11,
    v_orden_base + 11,
    'ZSI2',
    'INSTALACION',
    v_cliente_destino,
    v_maquina_auto,
    v_tecnico,
    v_tag || ' INSTALACION AUTO',
    current_date,
    current_date,
    'en_ruta',
    0,
    648
  )
  returning id into v_servicio_instalacion_auto;

  update public.servicios
  set status = 'completado'
  where id = v_servicio_instalacion_auto;

  -- 3) RETIRO adicional para dejar un abierto visible en lista
  insert into public.servicios (
    orden,
    aviso,
    clase_orden,
    tipo_servicio,
    cliente_id,
    maquina_id,
    tecnico_id,
    descripcion,
    fecha_solicitud,
    fecha_servicio,
    status,
    costo_refacciones,
    costo_mano_obra
  )
  values (
    v_orden_base + 12,
    v_orden_base + 12,
    'ZSM1',
    'RETIRO',
    v_cliente_origen,
    v_maquina_open,
    v_tecnico,
    v_tag || ' RETIRO OPEN',
    current_date,
    current_date,
    'en_ruta',
    0,
    648
  )
  returning id into v_servicio_retiro_open;

  update public.servicios
  set status = 'completado'
  where id = v_servicio_retiro_open;

  raise notice 'QA LISTO';
  raise notice 'Maquina AUTO (ciclo completo): %', v_maquina_auto;
  raise notice 'Maquina OPEN (debe quedar en taller): %', v_maquina_open;
  raise notice 'Maquina MANUAL (usar boton Registrar maquina): %', v_maquina_manual;
  raise notice 'Ordenes creadas: %, %, %', v_orden_base + 10, v_orden_base + 11, v_orden_base + 12;
end $$;

commit;

-- ============================================================
-- Validaciones rapidas (ejecutar despues)
-- ============================================================

-- A) Ver maquinas QA
select id, serie, modelo, status, cliente_id
from public.maquinas
where serie like 'QA-TALLER-%'
order by serie;

-- B) Ver historial de taller
select
  met.id,
  m.serie,
  met.fecha_entrada,
  met.fecha_salida,
  met.status,
  met.orden,
  met.servicio_id
from public.maquinas_en_taller met
join public.maquinas m on m.id = met.maquina_id
where m.serie like 'QA-TALLER-%'
order by met.created_at desc;

-- C) Ver movimientos generados
select
  mov.id,
  m.serie,
  mov.accion,
  mov.motivo,
  mov.origen,
  mov.destino,
  mov.orden_servicio,
  mov.fecha_movimiento,
  mov.created_at
from public.maquinas_taller_movimientos mov
join public.maquinas m on m.id = mov.maquina_id
where m.serie like 'QA-TALLER-%'
order by mov.created_at desc;

-- D) Maquina para probar el boton manual en UI
select id, serie, status
from public.maquinas
where serie = 'QA-TALLER-MANUAL-202604';

-- ============================================================
-- Limpieza (opcional)
-- ============================================================
-- Descomenta este bloque si quieres borrar los datos QA.
--
-- begin;
-- delete from public.maquinas_taller_movimientos
-- where maquina_id in (
--   select id from public.maquinas where serie like 'QA-TALLER-%'
-- );
--
-- delete from public.maquinas_en_taller
-- where maquina_id in (
--   select id from public.maquinas where serie like 'QA-TALLER-%'
-- );
--
-- delete from public.servicios
-- where descripcion like 'QA_TALLER_202604%';
--
-- update public.maquinas
-- set status = 'operando'
-- where serie like 'QA-TALLER-%';
--
-- delete from public.maquinas
-- where serie like 'QA-TALLER-%';
--
-- delete from public.clientes
-- where codigo_cliente in ('QA-TALLER-ORIGEN-202604', 'QA-TALLER-DESTINO-202604');
-- commit;
