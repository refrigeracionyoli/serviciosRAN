import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  MapPin,
  ScanSearch,
  Wrench,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { TecnicoHomeSkeleton } from '@/components/shared/TecnicoSkeletons'
import { MantenimientoStatusBadge, ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/hooks/use-auth'
import { useEditarMantenimientoMutation, useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { useToast } from '@/hooks/use-toast'
import { useCompletarServicioConRefaccionesMutation, useServiciosQuery } from '@/hooks/use-servicios'
import { getErrorMessage, isBrowserOnline } from '@/lib/offline/network'
import { formatDate, formatLocalIsoDate } from '@/lib/utils'
import type { MantenimientoPoliza, Servicio } from '@/types/domain.types'

function getCompletionMessage(servicio: Servicio, syncStatus: 'pending' | 'synced' | 'failed' | 'conflict') {
  if (syncStatus === 'synced') {
    return {
      title: 'Servicio completado',
      description: `${servicio.cliente?.nombre ?? 'El servicio'} quedó marcado como completado.`,
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'pending') {
    if (isBrowserOnline()) {
      return {
        title: 'Servicio registrado',
        description: 'El cambio quedó guardado y se terminará de procesar en segundo plano.',
        variant: 'default' as const,
      }
    }

    return {
      title: 'Servicio guardado offline',
      description: 'El cambio quedó registrado localmente y se sincronizará cuando vuelva la conexión.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'conflict') {
    return {
      title: 'Cambio marcado, pero requiere revisión',
      description: 'El servicio quedó actualizado localmente, pero la sincronización detectó un conflicto.',
      variant: 'destructive' as const,
    }
  }

  return {
    title: 'Cambio registrado con observaciones',
    description: 'El servicio quedó actualizado localmente, pero la sincronización no pudo cerrarse correctamente.',
    variant: 'destructive' as const,
  }
}

function normalizeTecnicoMantenimientoError(error: unknown): string {
  const message = getErrorMessage(error, 'Ocurrió un error al actualizar el mantenimiento.')
  if (/row-level security|permission denied|new row violates|is not a function|constraint|violates/i.test(message)) {
    return 'No se pudo actualizar el mantenimiento en este momento.'
  }
  return message
}

export function TecnicoHomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [servicioPorCompletar, setServicioPorCompletar] = useState<Servicio | null>(null)
  const [mantenimientoPorCompletar, setMantenimientoPorCompletar] = useState<MantenimientoPoliza | null>(null)
  const today = formatLocalIsoDate(new Date())

  const { mutateAsync: completarServicio, isPending: isCompleting } = useCompletarServicioConRefaccionesMutation()
  const { mutateAsync: editarMantenimiento, isPending: isCompletingMantenimiento } = useEditarMantenimientoMutation()
  const { data: servicios = [], isLoading } = useServiciosQuery({
    status: 'en_ruta',
    tecnicoId: user?.id ?? null,
    clienteId: null,
    fechaDesde: today,
    fechaHasta: today,
    tipoServicio: null,
    search: null,
  }, {
    enabled: Boolean(user?.id),
  })
  const { data: serviciosCompletados = [], isLoading: isLoadingServiciosCompletados } = useServiciosQuery({
    status: 'completado',
    tecnicoId: user?.id ?? null,
    clienteId: null,
    fechaDesde: today,
    fechaHasta: today,
    tipoServicio: null,
    search: null,
  }, {
    enabled: Boolean(user?.id),
  })
  const { data: mantenimientos = [], isLoading: isLoadingMantenimientos } = useMantenimientosQuery()

  const serviciosDelDia = useMemo(() => {
    return servicios
      .filter((servicio) => {
        if (!user?.id) return true
        return (
          servicio.status === 'en_ruta'
          && servicio.fecha_servicio === today
          && (servicio.tecnico_id === user.id || servicio.tecnico?.id === user.id)
        )
      })
      .sort((left, right) => {
        const leftOrden = left.orden ?? Number.MAX_SAFE_INTEGER
        const rightOrden = right.orden ?? Number.MAX_SAFE_INTEGER
        if (leftOrden !== rightOrden) {
          return leftOrden - rightOrden
        }

        return left.created_at.localeCompare(right.created_at)
      })
  }, [servicios, today, user?.id])

  const serviciosCompletadosDelDia = useMemo(() => {
    return serviciosCompletados
      .filter((servicio) => {
        if (!user?.id) return true
        return (
          servicio.status === 'completado'
          && servicio.fecha_servicio === today
          && (servicio.tecnico_id === user.id || servicio.tecnico?.id === user.id)
        )
      })
      .sort((left, right) => {
        const leftDate = left.fecha_cierre ?? left.fecha_servicio ?? left.updated_at ?? left.created_at
        const rightDate = right.fecha_cierre ?? right.fecha_servicio ?? right.updated_at ?? right.created_at
        return rightDate.localeCompare(leftDate)
      })
  }, [serviciosCompletados, today, user?.id])

  const mantenimientosAsignados = useMemo(() => {
    return mantenimientos
      .filter((mantenimiento) => {
        if (!user?.id) return true
        return mantenimiento.tecnico_id === user.id || mantenimiento.tecnico?.id === user.id
      })
      .sort((left, right) => {
        const leftActivo = left.status === 'pendiente' || left.status === 'en_ruta'
        const rightActivo = right.status === 'pendiente' || right.status === 'en_ruta'

        if (leftActivo !== rightActivo) {
          return leftActivo ? -1 : 1
        }

        const leftDate = left.fecha_visita ?? left.created_at
        const rightDate = right.fecha_visita ?? right.created_at
        return leftDate.localeCompare(rightDate)
      })
  }, [mantenimientos, user?.id])

  const activos = serviciosDelDia
  const finalizados = serviciosCompletadosDelDia
  const mantenimientosActivos = mantenimientosAsignados.filter((mantenimiento) => mantenimiento.status === 'pendiente' || mantenimiento.status === 'en_ruta')
  const mantenimientosFinalizados = mantenimientosAsignados.filter((mantenimiento) => mantenimiento.status === 'realizado')
  const totalAsignados = activos.length + mantenimientosActivos.length
  const totalFinalizados = finalizados.length + mantenimientosFinalizados.length
  const hasAsignaciones = totalAsignados > 0 || totalFinalizados > 0

  const confirmarCompletarServicio = async () => {
    if (!servicioPorCompletar) return

    try {
      const result = await completarServicio({
        serviceId: servicioPorCompletar.id,
        items: [],
        baseCostoRefacciones: servicioPorCompletar.costo_refacciones ?? 0,
        expectedUpdatedAt: servicioPorCompletar.updated_at ?? null,
        expectedStatus: servicioPorCompletar.status ?? null,
      })

      toast(getCompletionMessage(servicioPorCompletar, result.syncStatus))
      setServicioPorCompletar(null)
    } catch (error) {
      toast({
        title: 'No se pudo completar el servicio',
        description: getErrorMessage(error, 'Ocurrió un error al actualizar el servicio.'),
        variant: 'destructive',
      })
    }
  }

  const confirmarCompletarMantenimiento = async () => {
    if (!mantenimientoPorCompletar) return

    try {
      await editarMantenimiento({
        id: mantenimientoPorCompletar.id,
        data: {
          status: 'realizado',
          fecha_visita: mantenimientoPorCompletar.fecha_visita ?? today,
          costo_refacciones: mantenimientoPorCompletar.costo_refacciones ?? 0,
        },
      })

      toast({
        title: 'Mantenimiento realizado',
        description: `${mantenimientoPorCompletar.cliente?.nombre ?? 'La sucursal'} quedó marcada como realizada.`,
      })
      setMantenimientoPorCompletar(null)
    } catch (error) {
      toast({
        title: 'No se pudo completar el mantenimiento',
        description: normalizeTecnicoMantenimientoError(error),
        variant: 'destructive',
      })
    }
  }

  if (isLoading || isLoadingServiciosCompletados || isLoadingMantenimientos) {
    return <TecnicoHomeSkeleton />
  }

  return (
    <>
      <div className="space-y-4 px-3.5 py-4">
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.3)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Asignaciones del día
          </p>
          <h1 className="mt-1.5 text-xl font-extrabold tracking-tight text-ran-navy">
            Ruta asignada
          </h1>
          <p className="mt-1 text-[13px] text-ran-slate">{formatDate(today)}</p>
          <p className="mt-2.5 text-[13px] text-slate-600">
            {totalAsignados} asignado(s) · {totalFinalizados} completado(s)
          </p>
        </section>

        {!hasAsignaciones ? (
          <EmptyState
            title="Sin asignaciones"
            description="No tienes servicios ni mantenimientos asignados por ahora."
            action={(
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => navigate('/tecnico/inventario')}
              >
                Ver mi inventario
              </Button>
            )}
          />
        ) : (
          <>
            <section className="space-y-2.5">
              <div>
                <h2 className="text-base font-bold text-ran-navy">En ruta</h2>
                <p className="text-[13px] text-ran-slate">Servicios en ruta de hoy y mantenimientos asignados.</p>
              </div>

              {activos.length === 0 && mantenimientosActivos.length === 0 ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                  No tienes asignaciones en ruta.
                </div>
              ) : (
                activos.map((servicio) => (
                  <article
                    key={servicio.id}
                    className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_-32px_rgba(15,23,42,0.32)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {servicio.orden ? `Orden ${servicio.orden}` : 'Servicio programado'}
                        </p>
                        <h3 className="mt-1 text-base font-bold leading-tight text-ran-navy">
                          {servicio.cliente?.nombre ?? 'Cliente sin nombre'}
                        </h3>
                        <p className="mt-1 text-[13px] text-ran-slate">{servicio.tipo_servicio}</p>
                      </div>
                      <ServicioStatusBadge status={servicio.status} />
                    </div>

                    <div className="mt-3 space-y-1.5 text-[13px] text-slate-600">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{servicio.cliente?.direccion ?? 'Sin dirección registrada'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{formatDate(servicio.fecha_servicio)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>
                          {servicio.maquina ? `${servicio.maquina.modelo} · ${servicio.maquina.serie}` : 'Sin máquina asignada'}
                        </span>
                      </div>
                    </div>

                    {servicio.descripcion && (
                      <p className="mt-3 text-[13px] leading-5 text-slate-700">
                        {servicio.descripcion}
                      </p>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl"
                        onClick={() => navigate(`/tecnico/servicio/${servicio.id}`)}
                      >
                        <ScanSearch className="h-4 w-4" />
                        Establecimiento
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl"
                        onClick={() => navigate(`/tecnico/servicio/${servicio.id}/evidencia`)}
                      >
                        <Camera className="h-4 w-4" />
                        Evidencia
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl"
                        onClick={() => navigate(`/tecnico/servicio/${servicio.id}/refacciones`)}
                      >
                        <Wrench className="h-4 w-4" />
                        Refacciones
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        className="w-full rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
                        onClick={() => setServicioPorCompletar(servicio)}
                        disabled={isCompleting}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Completar
                      </Button>
                    </div>
                  </article>
                ))
              )}

              {mantenimientosActivos.map((mantenimiento) => (
                <article
                  key={`mantenimiento-${mantenimiento.id}`}
                  className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_-32px_rgba(15,23,42,0.32)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Mantenimiento de póliza
                      </p>
                      <h3 className="mt-1 text-base font-bold leading-tight text-ran-navy">
                        {mantenimiento.cliente?.nombre ?? 'Sucursal sin nombre'}
                      </h3>
                      <p className="mt-1 text-[13px] text-ran-slate">{mantenimiento.tipo_servicio}</p>
                    </div>
                    <MantenimientoStatusBadge status={mantenimiento.status} />
                  </div>

                  <div className="mt-3 space-y-1.5 text-[13px] text-slate-600">
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{mantenimiento.cliente?.direccion ?? 'Sin dirección registrada'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{mantenimiento.fecha_visita ? formatDate(mantenimiento.fecha_visita) : 'Sin fecha programada'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>
                        {mantenimiento.maquina ? `${mantenimiento.maquina.modelo} · ${mantenimiento.maquina.serie}` : 'Sin máquina asignada'}
                      </span>
                    </div>
                  </div>

                  {mantenimiento.notas && (
                    <p className="mt-3 text-[13px] leading-5 text-slate-700">
                      {mantenimiento.notas}
                    </p>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full rounded-xl"
                      onClick={() => navigate(`/tecnico/mantenimiento/${mantenimiento.id}`)}
                    >
                      <Wrench className="h-4 w-4" />
                      Refacciones
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      className="w-full rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
                      onClick={() => setMantenimientoPorCompletar(mantenimiento)}
                      disabled={isCompletingMantenimiento}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Realizar
                    </Button>
                  </div>
                </article>
              ))}
            </section>

            {(finalizados.length > 0 || mantenimientosFinalizados.length > 0) && (
              <section className="space-y-2.5">
                <div>
                  <h2 className="text-base font-bold text-ran-navy">Completados</h2>
                  <p className="text-[13px] text-ran-slate">Servicios y mantenimientos ya registrados como completados.</p>
                </div>

                <div className="space-y-2.5">
                  {finalizados.map((servicio) => (
                    <div
                      key={servicio.id}
                      className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_34px_-32px_rgba(15,23,42,0.34)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ran-navy">{servicio.cliente?.nombre ?? 'Cliente sin nombre'}</p>
                          <p className="mt-1 text-[13px] text-ran-slate">{servicio.tipo_servicio}</p>
                        </div>
                        <ServicioStatusBadge status={servicio.status} />
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full rounded-xl"
                          onClick={() => navigate(`/tecnico/servicio/${servicio.id}`)}
                        >
                          <ScanSearch className="h-4 w-4" />
                          Detalle
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full rounded-xl"
                          onClick={() => navigate(`/tecnico/servicio/${servicio.id}/evidencia`)}
                        >
                          <Camera className="h-4 w-4" />
                          Evidencia
                        </Button>
                      </div>
                    </div>
                  ))}

                  {mantenimientosFinalizados.map((mantenimiento) => (
                    <div
                      key={`mantenimiento-finalizado-${mantenimiento.id}`}
                      className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_34px_-32px_rgba(15,23,42,0.34)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ran-navy">{mantenimiento.cliente?.nombre ?? 'Sucursal sin nombre'}</p>
                          <p className="mt-1 text-[13px] text-ran-slate">{mantenimiento.tipo_servicio}</p>
                        </div>
                        <MantenimientoStatusBadge status={mantenimiento.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <AlertDialog open={Boolean(servicioPorCompletar)} onOpenChange={(open) => !open && setServicioPorCompletar(null)}>
        <AlertDialogContent className="max-w-sm rounded-[24px] border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar servicio como completado</AlertDialogTitle>
            <AlertDialogDescription>
              {servicioPorCompletar
                ? `Se actualizará el servicio de ${servicioPorCompletar.cliente?.nombre ?? 'este cliente'} como completado.`
                : 'Confirma para continuar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
              onClick={confirmarCompletarServicio}
              disabled={isCompleting}
            >
              {isCompleting ? 'Guardando...' : 'Completar servicio'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(mantenimientoPorCompletar)} onOpenChange={(open) => !open && setMantenimientoPorCompletar(null)}>
        <AlertDialogContent className="max-w-sm rounded-[24px] border-slate-200">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <AlertDialogTitle>Marcar mantenimiento como realizado</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {mantenimientoPorCompletar
                ? `Se actualizará el mantenimiento de ${mantenimientoPorCompletar.cliente?.nombre ?? 'esta sucursal'} como realizado.`
                : 'Confirma para continuar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
              onClick={confirmarCompletarMantenimiento}
              disabled={isCompletingMantenimiento}
            >
              {isCompletingMantenimiento ? 'Guardando...' : 'Marcar realizado'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
