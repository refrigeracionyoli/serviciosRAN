import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { crearMantenimientoSchema, type CrearMantenimientoInput } from '@/schemas/mantenimiento.schema'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { usePolizasQuery } from '@/hooks/use-polizas'
import { formatMXN } from '@/lib/utils'
import type { MantenimientoPoliza } from '@/types/domain.types'

interface Props {
  onSubmit: (data: CrearMantenimientoInput) => void
  isLoading?: boolean
  mantenimiento?: MantenimientoPoliza
  initialPolizaId?: number | null
  forceStatus?: 'pendiente' | 'en_ruta' | 'realizado'
  hideStatusField?: boolean
  requireTecnico?: boolean
  hideCostoRefaccionesField?: boolean
  submitLabel?: string
}

export function MantenimientoForm({
  onSubmit,
  isLoading,
  mantenimiento,
  initialPolizaId,
  forceStatus,
  hideStatusField,
  requireTecnico,
  hideCostoRefaccionesField,
  submitLabel,
}: Props) {
  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: polizas = [] } = usePolizasQuery()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CrearMantenimientoInput>({
    resolver: zodResolver(crearMantenimientoSchema),
    defaultValues: mantenimiento
      ? {
          poliza_id: mantenimiento.poliza_id,
          cliente_id: mantenimiento.cliente_id,
          maquina_id: mantenimiento.maquina_id,
          tecnico_id: mantenimiento.tecnico_id,
          status: mantenimiento.status,
          tipo_servicio: mantenimiento.tipo_servicio,
          descripcion: mantenimiento.descripcion ?? undefined,
          fecha_visita: mantenimiento.fecha_visita,
          costo_refacciones: mantenimiento.costo_refacciones,
          costo_mano_obra: mantenimiento.costo_mano_obra,
          notas: mantenimiento.notas ?? undefined,
        }
      : {
          status: forceStatus ?? 'pendiente',
          tipo_servicio: 'MTTO PREVENTIVO RUTA',
          costo_refacciones: 0,
          costo_mano_obra: 0,
          fecha_visita: null,
        },
  })

  const polizaId = watch('poliza_id')
  const tecnicoId = watch('tecnico_id')
  const status = watch('status')
  const costoManoObra = watch('costo_mano_obra')
  const costoManoObraSeguro = Number.isFinite(costoManoObra) ? Math.max(0, Number(costoManoObra)) : 0
  const selectedPoliza = polizas.find((p) => p.id === polizaId)

  useEffect(() => {
    if (!initialPolizaId) return

    const poliza = polizas.find((item) => item.id === initialPolizaId && item.activa)
    if (!poliza) return
    if (polizaId === poliza.id) return

    setValue('poliza_id', poliza.id, { shouldValidate: true })
    setValue('cliente_id', poliza.cliente_id, { shouldValidate: true })
    setValue('maquina_id', poliza.maquina_id, { shouldValidate: true })
  }, [initialPolizaId, polizaId, polizas, setValue])

  useEffect(() => {
    if (!forceStatus) return
    setValue('status', forceStatus, { shouldValidate: true })
  }, [forceStatus, setValue])

  const handlePolizaChange = (polizaIdStr: string) => {
    const id = Number(polizaIdStr)
    const poliza = polizas.find((p) => p.id === id)
    setValue('poliza_id', id, { shouldValidate: true })
    if (poliza) {
      setValue('cliente_id', poliza.cliente_id, { shouldValidate: true })
      setValue('maquina_id', poliza.maquina_id, { shouldValidate: true })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Póliza */}
      <div className="space-y-1.5">
        <Label>Póliza *</Label>
        <Select
          value={polizaId ? polizaId.toString() : undefined}
          onValueChange={handlePolizaChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar póliza…" />
          </SelectTrigger>
          <SelectContent>
            {polizas.filter((p) => p.activa).map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>
                {p.cliente?.nombre ?? `Cliente ${p.cliente_id}`} — {p.maquina?.serie ?? `Máq. ${p.maquina_id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.poliza_id && (
          <p className="text-xs text-destructive">{errors.poliza_id.message}</p>
        )}
      </div>

      {selectedPoliza && (
        <div className="rounded-lg bg-ran-ice p-3 text-sm">
          <p className="font-medium text-ran-navy">{selectedPoliza.cliente?.nombre}</p>
          <p className="text-ran-slate">
            {selectedPoliza.maquina?.serie} — {selectedPoliza.maquina?.modelo}
          </p>
        </div>
      )}

      {/* Técnico */}
      <div className="space-y-1.5">
        <Label>Técnico {requireTecnico ? '*' : ''}</Label>
        <Select
          value={tecnicoId ?? (requireTecnico ? undefined : 'none')}
          onValueChange={(value) =>
            setValue('tecnico_id', !requireTecnico && value === 'none' ? null : value, { shouldValidate: true })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={requireTecnico ? 'Seleccionar técnico…' : 'Seleccionar técnico (opcional)…'} />
          </SelectTrigger>
          <SelectContent>
            {!requireTecnico ? <SelectItem value="none">Sin asignar todavía</SelectItem> : null}
            {tecnicos.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.tecnico_id && (
          <p className="text-xs text-destructive">{errors.tecnico_id.message}</p>
        )}
      </div>

      {/* Status */}
      {!hideStatusField ? (
        <div className="space-y-1.5">
          <Label>Status inicial</Label>
          <Select
            value={status ?? 'pendiente'}
            onValueChange={(value) => setValue('status', value as 'pendiente' | 'en_ruta' | 'realizado', { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="en_ruta">En ruta</SelectItem>
              <SelectItem value="realizado">Realizado</SelectItem>
            </SelectContent>
          </Select>
          {errors.status && (
            <p className="text-xs text-destructive">{errors.status.message}</p>
          )}
        </div>
      ) : null}

      {/* Fecha visita */}
      <div className="space-y-1.5">
        <Label htmlFor="fecha_visita">Fecha de visita (opcional)</Label>
        <Input
          id="fecha_visita"
          type="date"
          {...register('fecha_visita', {
            setValueAs: (value: string) => (value === '' ? null : value),
          })}
        />
        <p className="text-xs text-ran-slate">Se puede capturar al completar el mantenimiento.</p>
        {errors.fecha_visita && (
          <p className="text-xs text-destructive">{errors.fecha_visita.message}</p>
        )}
      </div>

      {/* Costos */}
      {hideCostoRefaccionesField ? (
        <div className="space-y-1.5">
          <Label htmlFor="costo_mano_obra">Mano de obra (MXN)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ran-slate">$</span>
            <Input
              id="costo_mano_obra"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="pl-7"
              {...register('costo_mano_obra', {
                setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
              })}
            />
          </div>
          <p className="text-xs text-ran-slate">{formatMXN(costoManoObraSeguro)}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="costo_mano_obra">Mano de obra (MXN)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ran-slate">$</span>
              <Input
                id="costo_mano_obra"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="pl-7"
                {...register('costo_mano_obra', {
                  setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
                })}
              />
            </div>
            <p className="text-xs text-ran-slate">{formatMXN(costoManoObraSeguro)}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="costo_refacciones">Refacciones (MXN)</Label>
            <Input
              id="costo_refacciones"
              type="number"
              min={0}
              step="0.01"
              {...register('costo_refacciones', {
                setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
              })}
            />
          </div>
        </div>
      )}

      {/* Notas */}
      <div className="space-y-1.5">
        <Label htmlFor="notas">Notas</Label>
        <textarea
          id="notas"
          {...register('notas')}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Observaciones del mantenimiento…"
        />
      </div>

      <Button type="submit" disabled={isLoading} className="w-full bg-ran-navy hover:bg-ran-navy/90">
        {isLoading
          ? 'Guardando…'
          : submitLabel ?? (mantenimiento ? 'Actualizar mantenimiento' : 'Registrar mantenimiento')}
      </Button>
    </form>
  )
}
