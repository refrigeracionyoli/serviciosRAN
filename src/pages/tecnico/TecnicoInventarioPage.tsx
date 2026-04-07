import { useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageLoading } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { Input } from '@/components/ui/input'
import { useInventarioTecnicoQuery } from '@/hooks/use-inventario'
import { useAuth } from '@/hooks/use-auth'
import { formatDate } from '@/lib/utils'

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function TecnicoInventarioPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [fecha, setFecha] = useState(formatLocalIsoDate(new Date()))
  const [search, setSearch] = useState('')
  const { data: inventarioTecnico = [], isLoading } = useInventarioTecnicoQuery(fecha, user?.id)

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return inventarioTecnico

    return inventarioTecnico.filter((row) => {
      return [
        row.item?.nombre ?? '',
        row.item?.descripcion ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [inventarioTecnico, search])

  const totalPiezas = filteredItems.reduce((acc, row) => acc + row.cantidad, 0)

  if (isLoading) return <PageLoading />

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5 text-ran-slate" />
        </button>
        <h2 className="font-bold text-ran-navy">Mi inventario del día</h2>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Fecha de inventario</p>
        <DatePickerInput value={fecha} onChange={(value) => setFecha(value ?? formatLocalIsoDate(new Date()))} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar en mi inventario..."
            className="h-10 pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-700">Items asignados</p>
          <p className="mt-1 text-xl font-bold text-blue-900">{filteredItems.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-700">Piezas totales</p>
          <p className="mt-1 text-xl font-bold text-emerald-900">{totalPiezas}</p>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          title="Sin inventario asignado"
          description={`No tienes piezas asignadas para ${formatDate(fecha)}.`}
        />
      ) : (
        <div className="space-y-2">
          {filteredItems.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg bg-white p-4 border border-border"
            >
              <div>
                <p className="font-medium text-ran-navy">{row.item?.nombre ?? `Item ${row.inventario_id}`}</p>
                {row.item?.descripcion && (
                  <p className="text-xs text-ran-slate">{row.item.descripcion}</p>
                )}
                <p className="mt-1 text-[11px] text-ran-slate">Asignado para {formatDate(row.fecha)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-ran-navy">{row.cantidad}</p>
                <p className="text-xs text-ran-slate">en mi ruta</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
