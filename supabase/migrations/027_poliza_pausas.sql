-- Periodos globales donde el seguimiento mensual de polizas queda pausado.
-- fecha_reanudacion es exclusiva: [fecha_inicio, fecha_reanudacion).

create table if not exists public.poliza_pausas (
  id                 bigserial primary key,
  fecha_inicio       date not null,
  fecha_reanudacion  date,
  motivo             text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles,
  resumed_at         timestamptz,
  resumed_by         uuid references public.profiles,
  constraint poliza_pausas_fechas_validas
    check (fecha_reanudacion is null or fecha_reanudacion >= fecha_inicio)
);

comment on table public.poliza_pausas is
  'Periodos globales donde el seguimiento mensual de polizas queda pausado.';
comment on column public.poliza_pausas.fecha_reanudacion is
  'Fecha exclusiva a partir de la cual las polizas vuelven a contar en el seguimiento mensual.';

create index if not exists idx_poliza_pausas_vigencia
  on public.poliza_pausas (fecha_inicio, fecha_reanudacion);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'poliza_pausas_no_overlap'
      and conrelid = 'public.poliza_pausas'::regclass
  ) then
    alter table public.poliza_pausas
      add constraint poliza_pausas_no_overlap
      exclude using gist (
        daterange(fecha_inicio, coalesce(fecha_reanudacion, 'infinity'::date), '[)') with &&
      );
  end if;
end $$;

alter table public.poliza_pausas enable row level security;

drop policy if exists "Admin: acceso total poliza_pausas" on public.poliza_pausas;
create policy "Admin: acceso total poliza_pausas"
  on public.poliza_pausas for all
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

drop policy if exists "Tecnico: lectura poliza_pausas" on public.poliza_pausas;
create policy "Tecnico: lectura poliza_pausas"
  on public.poliza_pausas for select
  using (auth.uid() is not null);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'poliza_pausas'
  ) then
    alter publication supabase_realtime add table public.poliza_pausas;
  end if;
end $$;
