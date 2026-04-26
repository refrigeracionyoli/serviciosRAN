drop policy if exists "Tecnico: actualiza sus mantenimientos de poliza" on public.mantenimientos_poliza;

create policy "Tecnico: actualiza sus mantenimientos de poliza"
  on public.mantenimientos_poliza for update
  using (
    tecnico_id = auth.uid()
  )
  with check (
    tecnico_id = auth.uid()
  );

drop policy if exists "Tecnico: elimina refacciones de sus mantenimientos" on public.servicio_refacciones;

create policy "Tecnico: elimina refacciones de sus mantenimientos"
  on public.servicio_refacciones for delete
  using (
    exists (
      select 1
      from public.mantenimientos_poliza
      where id = mantenimiento_id
        and tecnico_id = auth.uid()
    )
  );
