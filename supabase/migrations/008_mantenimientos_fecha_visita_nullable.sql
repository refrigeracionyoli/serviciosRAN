-- Permite registrar mantenimientos sin fecha de visita al momento de asignarlos.
-- La fecha se captura después, cuando el técnico/admin marca el mantenimiento como realizado.
alter table public.mantenimientos_poliza
  alter column fecha_visita drop not null;
