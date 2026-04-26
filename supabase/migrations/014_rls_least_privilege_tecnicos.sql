-- Endurece RLS para tecnicos (principio de minimo privilegio):
-- evita lectura global de clientes, maquinas y polizas.

-- CLIENTES: quitar lectura global y permitir solo relacionados al tecnico.
drop policy if exists "Todos leen clientes" on public.clientes;

create policy "Tecnico: lee clientes relacionados"
  on public.clientes for select
  using (
    (select role from public.profiles where id = auth.uid()) = 'tecnico'
    and (
      exists (
        select 1
        from public.servicios s
        where s.cliente_id = clientes.id
          and s.tecnico_id = auth.uid()
      )
      or exists (
        select 1
        from public.mantenimientos_poliza mp
        where mp.cliente_id = clientes.id
          and mp.tecnico_id = auth.uid()
      )
    )
  );

-- MAQUINAS: quitar lectura global y permitir solo relacionadas al tecnico.
drop policy if exists "Todos leen maquinas" on public.maquinas;

create policy "Tecnico: lee maquinas relacionadas"
  on public.maquinas for select
  using (
    (select role from public.profiles where id = auth.uid()) = 'tecnico'
    and (
      exists (
        select 1
        from public.servicios s
        where s.maquina_id = maquinas.id
          and s.tecnico_id = auth.uid()
      )
      or exists (
        select 1
        from public.mantenimientos_poliza mp
        where mp.maquina_id = maquinas.id
          and mp.tecnico_id = auth.uid()
      )
    )
  );

-- POLIZAS: reemplazar lectura global de tecnico por solo polizas asignadas.
drop policy if exists "Técnico: lee polizas" on public.polizas;

create policy "Tecnico: lee polizas asignadas"
  on public.polizas for select
  using (
    (select role from public.profiles where id = auth.uid()) = 'tecnico'
    and exists (
      select 1
      from public.mantenimientos_poliza mp
      where mp.poliza_id = polizas.id
        and mp.tecnico_id = auth.uid()
    )
  );
