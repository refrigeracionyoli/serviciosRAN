drop policy if exists "Tecnico: elimina evidencias de sus servicios" on public.evidencias;

create policy "Tecnico: elimina evidencias de sus servicios"
  on public.evidencias
  for delete
  using (
    exists (
      select 1
      from public.servicios
      where servicios.id = evidencias.servicio_id
        and servicios.tecnico_id = auth.uid()
    )
  );
