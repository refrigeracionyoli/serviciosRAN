do $$
declare
  target_table text;
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach target_table in array array[
      'clientes',
      'maquinas',
      'profiles',
      'polizas',
      'poliza_estado_historial',
      'mantenimientos_poliza',
      'cierres',
      'maquinas_en_taller',
      'maquinas_taller_movimientos'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = target_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', target_table);
      end if;
    end loop;
  end if;
end $$;
