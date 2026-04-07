import { useState } from 'react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ExportButton } from '@/components/shared/ExportButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { formatWeek, getWeekRange } from '@/lib/utils'

export function ReporteSemanalPage() {
  const today = new Date()
  const [fecha, setFecha] = useState(today.toISOString().split('T')[0])

  const selectedDate = new Date(fecha + 'T00:00:00')
  const semana = formatWeek(selectedDate)
  const { inicio, fin } = getWeekRange(selectedDate)

  return (
    <div>
      <PageHeader
        title="Reporte semanal"
        description="Genera el reporte semanal de servicios en formato Heineken"
      />
      <div className="p-6 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configurar período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Selecciona cualquier día de la semana</Label>
              <Input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>

            <div className="rounded-lg bg-ran-ice p-3 text-sm">
              <p className="font-semibold text-ran-navy">Semana: {semana}</p>
              <p className="text-ran-slate">
                Del {inicio} al {fin}
              </p>
            </div>

            <ExportButton
              endpoint="generar-reporte-semanal"
              payload={{ semana, fechaInicio: inicio, fechaFin: fin }}
              filename={`reporte-semanal-${semana}.xlsx`}
              label="Generar y descargar Excel"
              className="w-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
