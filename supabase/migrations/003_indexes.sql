-- ─────────────────────────────────────────────────────────────
-- 003_indexes.sql
-- Índices para optimizar las queries más frecuentes
-- ─────────────────────────────────────────────────────────────

create index idx_servicios_tecnico       on servicios (tecnico_id);
create index idx_servicios_status        on servicios (status);
create index idx_servicios_fechas        on servicios (fecha_solicitud, fecha_servicio);
create index idx_servicios_cliente       on servicios (cliente_id);
create index idx_servicios_updated_at    on servicios (updated_at);
create index idx_evidencias_servicio     on evidencias (servicio_id);
create index idx_maquinas_cliente        on maquinas (cliente_id);
create index idx_inv_tecnico_fecha       on inventario_tecnico (tecnico_id, fecha);
create index idx_movimientos_inventario  on movimientos_inventario (inventario_id, created_at);
create index idx_mantenimientos_poliza   on mantenimientos_poliza (poliza_id);
create index idx_mantenimientos_tecnico  on mantenimientos_poliza (tecnico_id);
create index idx_mantenimientos_fecha    on mantenimientos_poliza (fecha_visita);
create index idx_cierres_servicio        on cierres (servicio_id);
create index idx_polizas_cliente         on polizas (cliente_id);
create index idx_polizas_maquina         on polizas (maquina_id);
create index idx_maquinas_en_taller_maquina on maquinas_en_taller (maquina_id);
create index idx_servicio_refacciones_servicio on servicio_refacciones (servicio_id);
create index idx_catalogo_pep_tipo       on catalogo_pep (tipo_servicio) where activo = true;
