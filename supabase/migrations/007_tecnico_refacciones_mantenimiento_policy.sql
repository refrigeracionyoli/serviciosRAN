-- Permite que tecnicos registren y consulten refacciones en mantenimientos asignados.

create policy "Tecnico: ve sus mantenimientos de poliza"
  on mantenimientos_poliza for select
  using (tecnico_id = auth.uid());

create policy "Tecnico: inserta refacciones en sus mantenimientos"
  on servicio_refacciones for insert
  with check (
    exists (
      select 1
      from mantenimientos_poliza
      where id = mantenimiento_id
        and tecnico_id = auth.uid()
    )
  );

create policy "Tecnico: ve refacciones de sus mantenimientos"
  on servicio_refacciones for select
  using (
    exists (
      select 1
      from mantenimientos_poliza
      where id = mantenimiento_id
        and tecnico_id = auth.uid()
    )
  );
