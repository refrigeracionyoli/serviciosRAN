-- Historial de cambios de estado en polizas para visualizar actividad por mes.

create table if not exists public.poliza_estado_historial (
  id          bigserial primary key,
  poliza_id   bigint not null references public.polizas on delete cascade,
  estado      text not null check (estado in ('activa', 'inactiva')),
  changed_at  timestamptz not null default now(),
  changed_by  uuid references public.profiles,
  motivo      text
);

create index if not exists idx_poliza_estado_historial_poliza_fecha
  on public.poliza_estado_historial (poliza_id, changed_at desc);

alter table public.poliza_estado_historial enable row level security;

create policy "Admin: acceso total poliza_estado_historial"
  on public.poliza_estado_historial for all
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Tecnico: lectura poliza_estado_historial"
  on public.poliza_estado_historial for select
  using (true);

create or replace function public.log_poliza_estado_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.poliza_estado_historial (poliza_id, estado, changed_at, changed_by)
    values (
      new.id,
      case when new.activa then 'activa' else 'inactiva' end,
      coalesce(new.created_at, now()),
      auth.uid()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.activa is distinct from old.activa then
    insert into public.poliza_estado_historial (poliza_id, estado, changed_by)
    values (
      new.id,
      case when new.activa then 'activa' else 'inactiva' end,
      auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_poliza_estado_historial on public.polizas;

create trigger trg_poliza_estado_historial
  after insert or update of activa on public.polizas
  for each row execute function public.log_poliza_estado_change();

-- Backfill inicial para polizas ya existentes.
insert into public.poliza_estado_historial (poliza_id, estado, changed_at)
select
  p.id,
  case when p.activa then 'activa' else 'inactiva' end,
  coalesce(p.created_at, now())
from public.polizas p
where not exists (
  select 1
  from public.poliza_estado_historial h
  where h.poliza_id = p.id
);
