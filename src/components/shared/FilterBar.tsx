import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useFiltrosStore } from '@/stores/filtros.store'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'

export function ServiciosFilterBar() {
  const { status, tecnicoId, fechaDesde, fechaHasta, search, setFiltro, resetFiltros } =
    useFiltrosStore()

  const { data: tecnicos } = useTecnicosQuery()
  const hasFilters = status || tecnicoId || fechaDesde || fechaHasta || search

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Búsqueda */}
      <div className="relative min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
        <Input
          placeholder="Buscar…"
          value={search ?? ''}
          onChange={(e) => setFiltro('search', e.target.value || null)}
          className="pl-9"
        />
      </div>

      {/* Status */}
      <Select
        value={status ?? 'all'}
        onValueChange={(v) => setFiltro('status', v === 'all' ? null : (v as typeof status))}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          <SelectItem value="pendiente">Pendiente</SelectItem>
          <SelectItem value="en_ruta">En ruta</SelectItem>
          <SelectItem value="completado">Completado</SelectItem>
          <SelectItem value="cerrado">Cerrado</SelectItem>
        </SelectContent>
      </Select>

      {/* Técnico */}
      <Select
        value={tecnicoId ?? 'all'}
        onValueChange={(v) => setFiltro('tecnicoId', v === 'all' ? null : v)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Técnico" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los técnicos</SelectItem>
          {tecnicos?.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Fecha desde */}
      <Input
        type="date"
        value={fechaDesde ?? ''}
        onChange={(e) => setFiltro('fechaDesde', e.target.value || null)}
        className="w-[160px]"
        title="Fecha desde"
      />

      {/* Fecha hasta */}
      <Input
        type="date"
        value={fechaHasta ?? ''}
        onChange={(e) => setFiltro('fechaHasta', e.target.value || null)}
        className="w-[160px]"
        title="Fecha hasta"
      />

      {/* Limpiar */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetFiltros} className="gap-1 text-ran-slate">
          <X className="h-4 w-4" />
          Limpiar
        </Button>
      )}
    </div>
  )
}
