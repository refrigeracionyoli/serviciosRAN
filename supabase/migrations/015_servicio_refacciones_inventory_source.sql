alter table public.servicio_refacciones
  add column if not exists inventory_source text;

update public.servicio_refacciones
set inventory_source = 'general'
where inventory_source is null;

alter table public.servicio_refacciones
  alter column inventory_source set default 'general';

alter table public.servicio_refacciones
  alter column inventory_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'servicio_refacciones_inventory_source_check'
  ) then
    alter table public.servicio_refacciones
      add constraint servicio_refacciones_inventory_source_check
      check (inventory_source in ('general', 'tecnico'));
  end if;
end;
$$;

create or replace function public.sync_inventario_from_servicio_refacciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_key text;
  v_referencia_id bigint;
  v_ubicacion text;
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if tg_op = 'UPDATE'
    and old.inventario_id is not distinct from new.inventario_id
    and old.cantidad = new.cantidad
    and old.servicio_id is not distinct from new.servicio_id
    and old.mantenimiento_id is not distinct from new.mantenimiento_id
    and coalesce(old.inventory_source, 'general') = coalesce(new.inventory_source, 'general')
  then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE')
    and old.inventario_id is not null
    and coalesce(old.inventory_source, 'general') = 'general'
  then
    update public.inventario
    set stock_actual = stock_actual + old.cantidad
    where id = old.inventario_id;

    select ref_key, referencia_id, ubicacion
    into v_ref_key, v_referencia_id, v_ubicacion
    from public._build_refaccion_context(old.servicio_id, old.mantenimiento_id);

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      old.inventario_id,
      'entrada',
      old.cantidad,
      format('%s Reversion de instalacion a %s', v_ref_key, v_ubicacion),
      v_referencia_id,
      v_user_id
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.inventario_id is not null
    and coalesce(new.inventory_source, 'general') = 'general'
  then
    update public.inventario
    set stock_actual = stock_actual - new.cantidad
    where id = new.inventario_id
      and stock_actual >= new.cantidad;

    if not found then
      raise exception 'Stock insuficiente para inventario_id=% (cantidad solicitada=%).',
        new.inventario_id,
        new.cantidad;
    end if;

    select ref_key, referencia_id, ubicacion
    into v_ref_key, v_referencia_id, v_ubicacion
    from public._build_refaccion_context(new.servicio_id, new.mantenimiento_id);

    insert into public.movimientos_inventario (
      inventario_id,
      tipo,
      cantidad,
      motivo,
      referencia_id,
      usuario_id
    )
    values (
      new.inventario_id,
      'salida',
      new.cantidad,
      format('%s Instalacion a %s', v_ref_key, v_ubicacion),
      v_referencia_id,
      v_user_id
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;
