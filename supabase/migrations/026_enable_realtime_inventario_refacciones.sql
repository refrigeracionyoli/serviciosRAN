do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'inventario'
    ) then
      alter publication supabase_realtime add table public.inventario;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'inventario_tecnico'
    ) then
      alter publication supabase_realtime add table public.inventario_tecnico;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'movimientos_inventario'
    ) then
      alter publication supabase_realtime add table public.movimientos_inventario;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'servicio_refacciones'
    ) then
      alter publication supabase_realtime add table public.servicio_refacciones;
    end if;
  end if;
end $$;
