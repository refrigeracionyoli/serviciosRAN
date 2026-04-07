import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cierreSchema, type CierreInput } from '@/schemas/cliente.schema'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { supabase } from '@/lib/supabase'
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

export function CierreForm({ servicioId, onSubmit, isLoading, onDraftChange }: Props) {
  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: catalogoCierres = [] } = useQuery({
    queryKey: ['cierres', 'catalogo-dinamico'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cierres')
        .select('parte_objeto, causa')
        .order('created_at', { ascending: false })
        .limit(1000)

      if (error) throw error
      return data as Array<{ parte_objeto: string | null; causa: string | null }>
    },
    staleTime: 1000 * 60 * 10,
  })

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
    defaultValues: { servicio_id: servicioId },
  })

  const parteObjetoValue = watch('parte_objeto') ?? null
  const causaValue = watch('causa') ?? null

  useEffect(() => {
    if (!onDraftChange) return
    const subscription = watch(() => onDraftChange())
    return () => subscription.unsubscribe()
  }, [watch, onDraftChange])

  const handleCierreSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    // Evita que el submit del popup dispare también el submit del formulario padre.
    event.stopPropagation()
    void handleSubmit(onSubmit)(event)
  }

  return (
    <form onSubmit={handleCierreSubmit} className="space-y-4">
      <input type="hidden" {...register('servicio_id', { valueAsNumber: true })} />

      {/* Aviso SAP */}
      <div className="space-y-1.5">
        <Label htmlFor="aviso">Aviso SAP</Label>
        <Input
          id="aviso"
          type="number"
          {...register('aviso', {
            setValueAs: (value: string) => (value === '' ? null : Number(value)),
          })}
          placeholder="Número de aviso"
        />
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
        <Select onValueChange={(v) => setValue('tecnico_id', v)}>
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
        <Label htmlFor="costo_total">Costo total (MXN)</Label>
        <Input
          id="costo_total"
          type="number"
          step="0.01"
          {...register('costo_total', {
            setValueAs: (value: string) => (value === '' ? null : Number(value)),
          })}
          placeholder="0.00"
        />
        <p className="text-xs text-ran-slate">Se puede dejar en blanco — se calculará del servicio</p>
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
          ⚠️ Al guardar este cierre, el status del servicio cambiará a <strong>Cerrado</strong> y no podrá ser modificado.
        </p>
      </div>

      <Button type="submit" disabled={isLoading} className="w-full bg-ran-navy hover:bg-ran-navy/90">
        {isLoading ? 'Cerrando servicio…' : 'Cerrar servicio'}
      </Button>
    </form>
  )
}
