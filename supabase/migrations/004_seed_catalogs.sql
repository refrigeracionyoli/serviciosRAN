-- ─────────────────────────────────────────────────────────────
-- 004_seed_catalogs.sql
-- Datos iniciales: catálogo PEP Heineken y configuración base
-- ─────────────────────────────────────────────────────────────

-- Catálogo PEP de Heineken — GZ Nuevo León
insert into catalogo_pep (gz, codigo_pep, nombre_pep, tipo_servicio) values
  -- Correctivos
  ('NUEVO LEON', 'NL-CORR-01', 'MTTO CORRECTIVO RUTA NL', 'MTTO CORRECTIVO RUTA'),
  ('NUEVO LEON', 'NL-CORR-02', 'MTTO CORRECTIVO PISO NL', 'MTTO CORRECTIVO PISO'),
  -- Preventivos
  ('NUEVO LEON', 'NL-PREV-01', 'MTTO PREVENTIVO RUTA NL', 'MTTO PREVENTIVO RUTA'),
  -- Instalaciones
  ('NUEVO LEON', 'NL-INST-01', 'INSTALACION DE EQUIPO NL', 'INSTALACION'),
  -- Retiro
  ('NUEVO LEON', 'NL-RET-01', 'RETIRO DE EQUIPO NL', 'RETIRO'),
  -- Garantía
  ('NUEVO LEON', 'NL-GAR-01', 'GARANTIA NL', 'GARANTIA');

-- Inventario base (refacciones más comunes)
insert into inventario (nombre, descripcion, stock_actual, stock_minimo, precio_unitario) values
  ('Filtro de agua', 'Filtro de agua para máquinas Hoshizaki', 10, 3, 266.00),
  ('Compresor KM901', 'Compresor para modelo KM901', 2, 1, 4500.00),
  ('Ventilador condensador', 'Motor ventilador del condensador', 5, 2, 850.00),
  ('Sensor de nivel', 'Sensor electrónico de nivel de agua', 8, 3, 320.00),
  ('Válvula de agua', 'Válvula solenoide de entrada de agua', 6, 2, 450.00),
  ('Termostato', 'Termostato de control de temperatura', 4, 2, 380.00),
  ('Correa de transmisión', 'Correa para mecanismo de hielo', 10, 4, 180.00),
  ('Módulo de hielo KM901', 'Módulo completo de producción de hielo', 1, 1, 3200.00),
  ('Control electrónico', 'Tarjeta de control principal', 2, 1, 2800.00),
  ('Kit de mantenimiento', 'Kit completo filtro + limpieza preventiva', 15, 5, 450.00);
