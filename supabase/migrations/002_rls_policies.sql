-- ─────────────────────────────────────────────────────────────
-- 002_rls_policies.sql
-- Row Level Security — todas las tablas
-- ─────────────────────────────────────────────────────────────

-- ─── PROFILES ───────────────────────────────────────────────
alter table profiles enable row level security;

create policy "Admin: acceso total a profiles"
  on profiles for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: ve su propio perfil"
  on profiles for select using (id = auth.uid());

-- CRÍTICO: nadie puede cambiar su propio role
create policy "Nadie eleva su role"
  on profiles for update
  using (id = auth.uid())
  with check (role = (select role from profiles where id = auth.uid()));

-- ─── SERVICIOS ──────────────────────────────────────────────
alter table servicios enable row level security;

create policy "Admin: acceso total a servicios"
  on servicios for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: ve solo sus servicios"
  on servicios for select using (tecnico_id = auth.uid());

create policy "Técnico: actualiza solo sus servicios (no puede cerrar)"
  on servicios for update
  using (tecnico_id = auth.uid())
  with check (tecnico_id = auth.uid() and status != 'cerrado');

-- Técnico NO tiene INSERT ni DELETE en servicios

-- ─── CIERRES ────────────────────────────────────────────────
alter table cierres enable row level security;

create policy "Solo admin gestiona cierres"
  on cierres for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── EVIDENCIAS ─────────────────────────────────────────────
alter table evidencias enable row level security;

create policy "Admin: ve todas las evidencias"
  on evidencias for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: inserta evidencias de sus servicios"
  on evidencias for insert
  with check (
    subida_por = auth.uid() and
    exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid())
  );

create policy "Técnico: ve evidencias de sus servicios"
  on evidencias for select
  using (exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid()));

-- ─── INVENTARIO ─────────────────────────────────────────────
alter table inventario enable row level security;

create policy "Todos leen inventario"
  on inventario for select using (true);

create policy "Solo admin modifica inventario"
  on inventario for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── INVENTARIO TÉCNICO ─────────────────────────────────────
alter table inventario_tecnico enable row level security;

create policy "Admin: acceso total inventario_tecnico"
  on inventario_tecnico for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: gestiona su inventario del día"
  on inventario_tecnico for all
  using (tecnico_id = auth.uid());

-- ─── MANTENIMIENTOS PÓLIZA ──────────────────────────────────
alter table mantenimientos_poliza enable row level security;

create policy "Solo admin gestiona mantenimientos"
  on mantenimientos_poliza for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── CLIENTES ──────────────────────────────────────────────
alter table clientes enable row level security;

create policy "Todos leen clientes"
  on clientes for select using (true);

create policy "Solo admin modifica clientes"
  on clientes for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── MÁQUINAS ──────────────────────────────────────────────
alter table maquinas enable row level security;

create policy "Todos leen maquinas"
  on maquinas for select using (true);

create policy "Solo admin modifica maquinas"
  on maquinas for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── PÓLIZAS ────────────────────────────────────────────────
alter table polizas enable row level security;

create policy "Admin: acceso total polizas"
  on polizas for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: lee polizas"
  on polizas for select using (true);

-- ─── SERVICIO REFACCIONES ───────────────────────────────────
alter table servicio_refacciones enable row level security;

create policy "Admin: acceso total servicio_refacciones"
  on servicio_refacciones for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Técnico: inserta refacciones en sus servicios"
  on servicio_refacciones for insert
  with check (
    exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid())
  );

create policy "Técnico: ve refacciones de sus servicios"
  on servicio_refacciones for select
  using (
    exists (select 1 from servicios where id = servicio_id and tecnico_id = auth.uid())
  );

-- ─── MOVIMIENTOS INVENTARIO ─────────────────────────────────
alter table movimientos_inventario enable row level security;

create policy "Admin: acceso total movimientos"
  on movimientos_inventario for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── MÁQUINAS EN TALLER ─────────────────────────────────────
alter table maquinas_en_taller enable row level security;

create policy "Admin: acceso total maquinas_en_taller"
  on maquinas_en_taller for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- ─── CATÁLOGO PEP ───────────────────────────────────────────
alter table catalogo_pep enable row level security;

create policy "Todos leen catalogo_pep"
  on catalogo_pep for select using (true);

create policy "Solo admin modifica catalogo_pep"
  on catalogo_pep for all
  using ((select role from profiles where id = auth.uid()) = 'admin');
