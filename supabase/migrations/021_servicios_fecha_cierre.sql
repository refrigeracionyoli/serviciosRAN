alter table public.servicios
add column if not exists fecha_cierre date;

update public.servicios as servicio
set fecha_cierre = cierre.fecha_cierre
from (
  select
    servicio_id,
    max(timezone('America/Monterrey', created_at)::date) as fecha_cierre
  from public.cierres
  group by servicio_id
) as cierre
where servicio.id = cierre.servicio_id
  and servicio.fecha_cierre is distinct from cierre.fecha_cierre;

update public.servicios
set fecha_cierre = timezone('America/Monterrey', updated_at)::date
where status = 'cerrado'
  and fecha_cierre is null
  and updated_at is not null;

update public.servicios
set fecha_cierre = fecha_servicio
where status = 'cerrado'
  and fecha_cierre is null
  and fecha_servicio is not null;

create index if not exists idx_servicios_status_fecha_cierre
on public.servicios (status, fecha_cierre);
