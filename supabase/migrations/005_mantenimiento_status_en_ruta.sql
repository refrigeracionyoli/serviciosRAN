-- Permite un estado intermedio para mantenimientos asignados y en proceso.
alter table mantenimientos_poliza
  drop constraint if exists mantenimientos_poliza_status_check;

alter table mantenimientos_poliza
  add constraint mantenimientos_poliza_status_check
  check (status in ('pendiente', 'en_ruta', 'realizado'));