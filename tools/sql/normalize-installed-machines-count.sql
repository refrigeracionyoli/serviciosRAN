-- Normaliza el catalogo de maquinas para produccion.
-- Objetivo: que "maquinas registradas" represente solo maquinas instaladas
-- y operando en un establecimiento. Las maquinas sin cliente o no operando
-- quedan inactivas/baja para no contaminar el conteo operativo.

begin;

set local search_path = public;
set local timezone = 'America/Monterrey';

select
  'maquinas_antes_total' as check_name,
  count(*)::integer as total
from public.maquinas
union all
select
  'maquinas_antes_operando_con_cliente',
  count(*)::integer
from public.maquinas
where activo = true
  and status = 'operando'
  and cliente_id is not null
union all
select
  'maquinas_a_desactivar',
  count(*)::integer
from public.maquinas
where activo = true
  and (
    cliente_id is null
    or status <> 'operando'
  );

update public.maquinas
set
  activo = false,
  status = 'baja',
  observaciones = concat_ws(
    ' ',
    nullif(observaciones, ''),
    '[Produccion] Inactivada para que el catalogo muestre solo maquinas instaladas/operando.'
  )
where activo = true
  and (
    cliente_id is null
    or status <> 'operando'
  );

select
  'maquinas_despues_total' as check_name,
  count(*)::integer as total
from public.maquinas
union all
select
  'maquinas_despues_operando_con_cliente',
  count(*)::integer
from public.maquinas
where activo = true
  and status = 'operando'
  and cliente_id is not null
union all
select
  'maquinas_despues_fuera_de_conteo_activas',
  count(*)::integer
from public.maquinas
where activo = true
  and (
    cliente_id is null
    or status <> 'operando'
  );

commit;
