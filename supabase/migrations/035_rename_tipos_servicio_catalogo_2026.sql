-- ─────────────────────────────────────────────────────────────
-- 035_rename_tipos_servicio_catalogo_2026.sql
-- Alinea los tipos de servicio ya capturados con el catálogo Heineken 2026.
--
-- Heineken renombró el concepto de flete entre GZ en el formato vigente desde el
-- 25 de agosto de 2026. El nombre anterior ya no existe en CatPEP, así que un
-- servicio que lo conserve se exporta sin código PEP y el pago se rechaza:
--
--   'FLETE MOV GZ - MAQUINA HIELO'  ->  'FLETE MOV GZ A GZ - MAQUINA HIELO'
--
-- Se guarda el nombre normalizado (un solo espacio). Heineken publica la variante
-- de máquina de hielo con espacio doble ("FLETE MOV GZ  A GZ - MAQUINA HIELO");
-- el reporte semanal resuelve esa escritura contra CatPEP al momento de exportar,
-- así que la base de datos no tiene que cargar con la errata.
--
-- Los conceptos nuevos ("FLETE MOV CEDIS A CEDIS - MAQUINA HIELO" y
-- "FLETES-TALLER - MOVIMIENTOS") no requieren migración: no existen registros
-- previos con esos nombres, sólo se agregan al selector de la aplicación.
-- ─────────────────────────────────────────────────────────────

do $$
declare
  v_renamed integer := 0;
  v_pendientes integer := 0;
begin
  -- Se desactiva el trigger de updated_at para no mover la marca de tiempo de los
  -- servicios históricos: la app la usa para resolver conflictos de sincronización
  -- offline y como último respaldo de la fecha en el reporte semanal. Un ALTER TABLE
  -- es transaccional, así que si algo falla el trigger vuelve solo.
  alter table public.servicios disable trigger trg_servicios_updated_at;

  update public.servicios
  set tipo_servicio = 'FLETE MOV GZ A GZ - MAQUINA HIELO'
  where regexp_replace(btrim(upper(tipo_servicio)), '\s+', ' ', 'g')
        = 'FLETE MOV GZ - MAQUINA HIELO';

  get diagnostics v_renamed = row_count;

  alter table public.servicios enable trigger trg_servicios_updated_at;

  select count(*)
  into v_pendientes
  from public.servicios
  where regexp_replace(btrim(upper(tipo_servicio)), '\s+', ' ', 'g')
        = 'FLETE MOV GZ - MAQUINA HIELO';

  if v_pendientes > 0 then
    raise exception 'Quedaron % servicios con el tipo de servicio anterior.', v_pendientes;
  end if;

  raise notice 'Servicios renombrados a "FLETE MOV GZ A GZ - MAQUINA HIELO": %', v_renamed;
end;
$$;
