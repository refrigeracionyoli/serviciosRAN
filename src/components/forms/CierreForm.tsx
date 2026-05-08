import { useEffect, useMemo, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cierreSchema, type CierreInput } from '@/schemas/cliente.schema'
import { useCierresCatalogoQuery } from '@/hooks/use-cierres'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { formatLocalIsoDate } from '@/lib/utils'
import type { Cierre } from '@/types/domain.types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CreatableCombobox } from '@/components/shared/CreatableCombobox'

interface Props {
  servicioId: number
  onSubmit: (data: CierreInput) => void
  isLoading?: boolean
  onDraftChange?: () => void
  defaultAviso?: number | null
  defaultTecnicoId?: string | null
  defaultCostoTotal?: number | null
  defaultFechaCierre?: string | null
  defaultDescripcion?: string | null
  cierre?: Cierre | null
  submitLabel?: string
  loadingLabel?: string
}

function normalizeCatalogValues(values: Array<string | null | undefined>): string[] {
  const map = new Map<string, string>()

  values.forEach((raw) => {
    const value = raw?.trim()
    if (!value) return
    const key = value.toLowerCase()
    if (!map.has(key)) {
      map.set(key, value)
    }
  })

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
}

export function CierreForm({
  servicioId,
  onSubmit,
  isLoading,
  onDraftChange,
  defaultAviso,
  defaultTecnicoId,
  defaultCostoTotal,
  defaultFechaCierre,
  defaultDescripcion,
  cierre,
  submitLabel = 'Cerrar servicio',
  loadingLabel = 'Cerrando servicio...',
}: Props) {
  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: catalogoCierres = [] } = useCierresCatalogoQuery()
  const todayIso = formatLocalIsoDate(new Date())

  const parteObjetoOptions = useMemo(
    () => normalizeCatalogValues(catalogoCierres.map((item) => item.parte_objeto)),
    [catalogoCierres],
  )

  const causaOptions = useMemo(
    () => normalizeCatalogValues(catalogoCierres.map((item) => item.causa)),
    [catalogoCierres],
  )

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CierreInput>({
    resolver: zodResolver(cierreSchema),
    defaultValues: {
      servicio_id: servicioId,
      aviso: defaultAviso ?? undefined,
      parte_objeto: cierre?.parte_objeto ?? undefined,
      causa: cierre?.causa ?? undefined,
      descripcion: cierre?.descripcion ?? defaultDescripcion ?? '',
      tecnico_id: defaultTecnicoId ?? undefined,
      costo_total: defaultCostoTotal ?? undefined,
      fecha_cierre: defaultFechaCierre && defaultFechaCierre <= todayIso
        ? defaultFechaCierre
        : todayIso,
      firma_receptor: cierre?.firma_receptor ?? undefined,
    },
  })

  const parteObjetoValue = watch('parte_objeto') ?? null
  const causaValue = watch('causa') ?? null
  const tecnicoIdValue = watch('tecnico_id')
  const fechaCierreValue = watch('fecha_cierre') ?? todayIso

  useEffect(() => {
    if (typeof defaultAviso === 'number') {
      setValue('aviso', defaultAviso)
    }
  }, [defaultAviso, setValue])

  useEffect(() => {
    setValue('parte_objeto', cierre?.parte_objeto ?? null)
    setValue('causa', cierre?.causa ?? null)
    setValue('descripcion', cierre?.descripcion ?? defaultDescripcion ?? '')
    setValue('firma_receptor', cierre?.firma_receptor ?? null)
  }, [cierre, defaultDescripcion, setValue])

  useEffect(() => {
    if (defaultTecnicoId) {
      setValue('tecnico_id', defaultTecnicoId)
    }
  }, [defaultTecnicoId, setValue])

  useEffect(() => {
    if (typeof defaultCostoTotal === 'number') {
      setValue('costo_total', defaultCostoTotal)
    }
  }, [defaultCostoTotal, setValue])

  useEffect(() => {
    if (defaultFechaCierre && defaultFechaCierre <= todayIso) {
      setValue('fecha_cierre', defaultFechaCierre)
    }
  }, [defaultFechaCierre, setValue, todayIso])

  useEffect(() => {
    if (!onDraftChange) return
    const subscription = watch(() => onDraftChange())
    return () => subscription.unsubscribe()
  }, [watch, onDraftChange])

  const handleCierreSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Evita que el submit del popup dispare también el submit del formulario padre.
    event.stopPropagation()
    void handleSubmit(onSubmit)(event)
  }

  return (
    <form onSubmit={handleCierreSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...register('servicio_id', { valueAsNumber: true })} />

      {/* Aviso SAP */}
      <div className="space-y-1.5">
        <Label htmlFor="aviso">Aviso SAP *</Label>
        <Input
          id="aviso"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          {...register('aviso', {
            setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
          })}
          placeholder="Número de aviso"
        />
        {errors.aviso && (
          <p className="text-xs text-destructive">{errors.aviso.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fecha_cierre">Fecha cierre / reporte *</Label>
        <input type="hidden" {...register('fecha_cierre')} />
        <DatePickerInput
          value={fechaCierreValue}
          onChange={(value) =>
            setValue('fecha_cierre', value ?? todayIso, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          placeholder="Fecha cierre"
          maxDate={todayIso}
        />
        {errors.fecha_cierre && (
          <p className="text-xs text-destructive">{errors.fecha_cierre.message}</p>
        )}
      </div>

      {/* Parte objeto + Causa */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Parte objeto</Label>
          <CreatableCombobox
            value={parteObjetoValue}
            options={parteObjetoOptions}
            onChange={(value) =>
              setValue('parte_objeto', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            placeholder="Seleccionar parte objeto"
            searchPlaceholder="Escribe para buscar o crear parte objeto"
            allowClear
            clearLabel="Sin especificar"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Causa</Label>
          <CreatableCombobox
            value={causaValue}
            options={causaOptions}
            onChange={(value) =>
              setValue('causa', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            placeholder="Seleccionar causa"
            searchPlaceholder="Escribe para buscar o crear causa"
            allowClear
            clearLabel="Sin especificar"
          />
        </div>
      </div>
      <p className="text-xs text-ran-slate">
        Si no encuentras una opción en la lista, escríbela y se guardará para futuros cierres.
      </p>

      {/* Técnico */}
      <div className="space-y-1.5">
        <Label>Técnico que realizó el servicio *</Label>
        <Select
          value={tecnicoIdValue ?? undefined}
          onValueChange={(v) =>
            setValue('tecnico_id', v, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar técnico…" />
          </SelectTrigger>
          <SelectContent>
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

      {/* Descripción */}
      <div className="space-y-1.5">
        <Label htmlFor="descripcion_cierre">Descripción del trabajo *</Label>
        <textarea
          id="descripcion_cierre"
          {...register('descripcion')}
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Describe el trabajo realizado, partes cambiadas, estado final del equipo…"
        />
        {errors.descripcion && (
          <p className="text-xs text-destructive">{errors.descripcion.message}</p>
        )}
      </div>

      {/* Costo total */}
      <div className="space-y-1.5">
        <Label htmlFor="costo_total">Costo reportado (MXN)</Label>
        <Input
          id="costo_total"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          {...register('costo_total', {
            setValueAs: (value: string) => (value === '' ? null : Number(value)),
          })}
          placeholder="0.00"
        />
        {errors.costo_total && (
          <p className="text-xs text-destructive">{errors.costo_total.message}</p>
        )}
      </div>

      {/* Firma receptor */}
      <div className="space-y-1.5">
        <Label htmlFor="firma_receptor">Firma del receptor</Label>
        <Input
          id="firma_receptor"
          {...register('firma_receptor')}
          placeholder="Nombre de quien firmó en la tienda"
        />
      </div>

      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
        <p className="text-sm font-medium text-amber-800">
          Al guardar este formulario, el status del servicio permanecerá como <strong>Cerrado</strong>.
        </p>
      </div>

      <Button type="submit" disabled={isLoading} className="w-full bg-ran-navy hover:bg-ran-navy/90">
        {isLoading ? loadingLabel : submitLabel}
      </Button>
    </form>
  )
}
