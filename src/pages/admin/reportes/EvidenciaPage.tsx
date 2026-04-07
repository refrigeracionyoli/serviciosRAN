import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ExportButton } from '@/components/shared/ExportButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useServiciosQuery } from '@/hooks/use-servicios'

export function EvidenciaPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: servicios = [] } = useServiciosQuery({ status: 'cerrado' })
  const filtered = servicios.filter(
    (s) =>
      s.orden?.toString().includes(search) ||
      s.cliente?.nombre?.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <PageHeader
        title="Evidencia fotográfica"
        description="Genera el reporte de evidencia OS en formato Heineken"
      />
      <div className="p-6 max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seleccionar servicio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
              <Input
                placeholder="Buscar por número de orden o cliente…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
              {filtered.slice(0, 20).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === s.id
                      ? 'bg-ran-navy text-white'
                      : 'hover:bg-ran-ice'
                  }`}
                >
                  <p className="font-medium">
                    {s.orden ? `Orden ${s.orden}` : `Servicio #${s.id}`}
                  </p>
                  <p className={`text-xs ${selectedId === s.id ? 'text-white/70' : 'text-ran-slate'}`}>
                    {s.cliente?.nombre ?? '—'} · {s.tipo_servicio}
                  </p>
                </button>
              ))}
            </div>

            {selectedId && (
              <ExportButton
                endpoint="generar-evidencia-os"
                payload={{ servicioId: selectedId }}
                filename={`evidencia-OS-${selectedId}.xlsx`}
                label="Generar evidencia OS"
                className="w-full"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
