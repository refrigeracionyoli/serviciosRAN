import { useNavigate } from 'react-router-dom'
import { Camera, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useAuth } from '@/hooks/use-auth'
import { formatDate } from '@/lib/utils'

export function TecnicoHomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]

  const { data: servicios = [], isLoading } = useServiciosQuery({
    fechaDesde: today,
    fechaHasta: today,
  })

  // RLS ya filtra por tecnico_id, solo mostramos los del técnico actual
  const activos = servicios.filter(
    (s) => s.status === 'pendiente' || s.status === 'en_ruta',
  )

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ran-navy">Mis servicios de hoy</h2>
        <p className="text-sm text-ran-slate">{formatDate(today)}</p>
      </div>

      {activos.length === 0 ? (
        <EmptyState
          title="Sin servicios asignados"
          description="No tienes servicios programados para hoy."
        />
      ) : (
        <div className="space-y-3">
          {activos.map((servicio) => (
            <Card key={servicio.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ran-navy truncate">
                        {servicio.cliente?.nombre ?? '—'}
                      </p>
                      <p className="text-sm text-ran-slate">{servicio.tipo_servicio}</p>
                      {servicio.cliente?.direccion && (
                        <p className="text-xs text-ran-slate mt-1 truncate">
                          {servicio.cliente.direccion}
                        </p>
                      )}
                    </div>
                    <ServicioStatusBadge status={servicio.status} />
                  </div>

                  {servicio.maquina && (
                    <div className="mt-2 rounded-lg bg-ran-ice px-3 py-2 text-xs">
                      <span className="font-medium text-ran-navy">
                        {servicio.maquina.modelo}
                      </span>
                      <span className="text-ran-slate"> · Serie: {servicio.maquina.serie}</span>
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex border-t border-border divide-x divide-border">
                  <button
                    type="button"
                    onClick={() => navigate(`/tecnico/servicio/${servicio.id}/refacciones`)}
                    className="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium text-ran-slate hover:bg-ran-ice transition-colors"
                  >
                    <Wrench className="h-4 w-4" />
                    Refacciones
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/tecnico/servicio/${servicio.id}/evidencia`)}
                    className="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium text-ran-navy hover:bg-ran-ice transition-colors"
                  >
                    <Camera className="h-4 w-4" />
                    Evidencia
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => navigate('/tecnico/inventario')}
      >
        Ver mi inventario del día
      </Button>
    </div>
  )
}
