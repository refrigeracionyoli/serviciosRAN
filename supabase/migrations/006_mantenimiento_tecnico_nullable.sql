-- Permite crear mantenimientos pendientes sin técnico asignado.
alter table mantenimientos_poliza
  alter column tecnico_id drop not null;