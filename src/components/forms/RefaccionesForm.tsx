import { useFieldArray, useForm } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { refaccionSchema } from '@/schemas/inventario.schema'
import { useInventarioQuery } from '@/hooks/use-inventario'
import { cn, formatMXN } from '@/lib/utils'
import type { ItemInventario } from '@/types/domain.types'

const formSchema = z.object({
  refacciones: z.array(refaccionSchema),
})

type FormValues = z.infer<typeof formSchema>
type RefaccionFormInput = z.infer<typeof refaccionSchema>
type RefaccionSource = 'general' | 'tecnico'

interface InventarioOption {
  item: ItemInventario
  maxCantidad: number | null
  disabled: boolean
}

function buildFormSchema(requireCatalogSelection: boolean) {
  if (!requireCatalogSelection) {
    return formSchema
  }

  return z.object({
    refacciones: z.array(
      refaccionSchema.refine(
        (item) => typeof item.inventario_id === 'number' && item.inventario_id > 0,
        { message: 'Selecciona una refacción del inventario.' },
      ),
    ),
  })
}

interface Props {
  onSubmit: (refacciones: RefaccionFormInput[]) => void
  onChange?: (refacciones: RefaccionFormInput[]) => void
  isLoading?: boolean
  defaultValues?: RefaccionFormInput[]
  tecnicoStockByInventarioId?: ReadonlyMap<number, number>
  showSubmitButton?: boolean
  requireCatalogSelection?: boolean
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase('es')
}

function normalizeRefaccionSource(source: RefaccionFormInput['inventory_source']): RefaccionSource {
  return source === 'tecnico' ? 'tecnico' : 'general'
}

function buildQuantityKey(source: RefaccionSource, inventarioId: number): string {
  return `${source}:${inventarioId}`
}

interface InventarioComboboxProps {
  value: number | null | undefined
  options: InventarioOption[]
  onChange: (inventarioId: string) => void
  placeholder: string
  allowClear?: boolean
  clearLabel?: string
}

function InventarioCombobox({
  value,
  options,
  onChange,
  placeholder,
  allowClear = false,
  clearLabel = 'Sin catálogo',
}: InventarioComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedOption = options.find((option) => option.item.id === value)
  const normalizedSearch = normalizeSearchValue(search)
  const filteredOptions = normalizedSearch
    ? options.filter((option) =>
        normalizeSearchValue(`${option.item.nombre} ${option.item.descripcion ?? ''}`).includes(normalizedSearch),
      )
    : options

  const handleSelect = (inventarioId: string) => {
    onChange(inventarioId)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left text-sm font-normal hover:bg-ran-ice/60"
        >
          <span className={cn('min-w-0 truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption ? selectedOption.item.nombre : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-ran-slate opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-2"
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar refacción"
          className="mb-2 h-9 rounded-lg text-sm"
          autoFocus
        />

        <div className="max-h-64 overflow-y-auto">
          {allowClear && (
            <button
              type="button"
              onClick={() => handleSelect('')}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-ran-ice',
                !selectedOption && 'bg-ran-ice text-ran-navy',
              )}
            >
              <Check
                className={cn(
                  'h-4 w-4 shrink-0',
                  !selectedOption ? 'text-ran-navy opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{clearLabel}</span>
            </button>
          )}

          {filteredOptions.map((option) => {
            const isSelected = selectedOption?.item.id === option.item.id
            const available = option.maxCantidad ?? option.item.stock_actual

            return (
              <button
                key={option.item.id}
                type="button"
                disabled={option.disabled}
                onClick={() => handleSelect(String(option.item.id))}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-ran-ice disabled:cursor-not-allowed disabled:opacity-45',
                  isSelected && 'bg-ran-ice text-ran-navy',
                )}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isSelected ? 'text-ran-navy opacity-100' : 'opacity-0',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.item.nombre}</span>
                  {option.item.descripcion && (
                    <span className="block truncate text-xs text-ran-slate">{option.item.descripcion}</span>
                  )}
                </span>
                <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-ran-slate">
                  {available} disp.
                </span>
              </button>
            )
          })}

          {filteredOptions.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Sin coincidencias</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RefaccionesForm({
  onSubmit,
  onChange,
  isLoading,
  defaultValues,
  tecnicoStockByInventarioId,
  showSubmitButton = true,
  requireCatalogSelection = false,
}: Props) {
  const { data: inventario = [] } = useInventarioQuery()
  const activeFormSchema = buildFormSchema(requireCatalogSelection)

  const { control, register, handleSubmit, watch, setValue, formState: { errors } } =
    useForm<FormValues>({
      resolver: zodResolver(activeFormSchema),
      defaultValues: {
        refacciones: defaultValues ?? [
          { nombre_refaccion: '', cantidad: 1, precio_unitario: 0, inventario_id: null, inventory_source: 'general' },
        ],
      },
    })

  const { fields, append, remove } = useFieldArray({ control, name: 'refacciones' })
  const refacciones = watch('refacciones')

  const inventarioById = useMemo(
    () => new Map(inventario.map((item) => [item.id, item] as const)),
    [inventario],
  )

  const initialQuantitiesByInventarioId = useMemo(() => {
    const map = new Map<string, number>()

    defaultValues?.forEach((item) => {
      if (!item.inventario_id) return
      const source = normalizeRefaccionSource(item.inventory_source)
      const key = buildQuantityKey(source, item.inventario_id)
      map.set(
        key,
        (map.get(key) ?? 0) + Number(item.cantidad ?? 0),
      )
    })

    return map
  }, [defaultValues])

  // Notificar al padre solo cuando el usuario modifica algo (no en el montaje inicial)
  useEffect(() => {
    if (!onChange) return
    const subscription = watch((values) => {
      if (values.refacciones) {
        onChange(
          values.refacciones.map((item) => ({ ...item })) as RefaccionFormInput[],
        )
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, onChange])

  const totalRefacciones = refacciones.reduce(
    (sum, r) => sum + (r.cantidad ?? 0) * (r.precio_unitario ?? 0),
    0,
  )

  const isSelectedInOtherRow = (index: number, inventarioId: number): boolean => {
    return refacciones.some((row, rowIndex) => rowIndex !== index && row?.inventario_id === inventarioId)
  }

  const isSelectedInAnyRow = (inventarioId: number): boolean => {
    return refacciones.some((row) => row?.inventario_id === inventarioId)
  }

  const getMaxCantidadForSource = (
    inventarioId: number,
    source: RefaccionSource,
    currentIndex?: number,
  ): number | null => {
    const item = inventarioById.get(inventarioId)
    if (!item) return null

    const initialQuantity = initialQuantitiesByInventarioId.get(buildQuantityKey(source, inventarioId)) ?? 0
    const quantityInOtherRows = refacciones.reduce((sum, row, rowIndex) => {
      if (
        rowIndex === currentIndex
        || row?.inventario_id !== inventarioId
        || normalizeRefaccionSource(row.inventory_source) !== source
      ) {
        return sum
      }

      return sum + Number(row.cantidad ?? 0)
    }, 0)
    const baseStock = source === 'tecnico'
      ? Number(tecnicoStockByInventarioId?.get(inventarioId) ?? 0)
      : Number(item.stock_actual ?? 0)

    return Math.max(0, baseStock + initialQuantity - quantityInOtherRows)
  }

  const getNextAddableInventoryItem = (): ItemInventario | null => {
    if (!requireCatalogSelection) return null

    return inventario.find((item) => (
      !isSelectedInAnyRow(item.id)
      && Number(getMaxCantidadForSource(item.id, 'general') ?? 0) > 0
    )) ?? null
  }

  const handleSelectInventario = (index: number, inventarioId: string) => {
    if (!inventarioId) {
      setValue(`refacciones.${index}.inventario_id`, null)
      if (requireCatalogSelection) {
        setValue(`refacciones.${index}.nombre_refaccion`, '')
      }
      return
    }
    const item = inventario.find((i) => i.id.toString() === inventarioId)
    if (item) {
      const maxCantidad = getMaxCantidad(index, item.id)
      const currentCantidad = Number(refacciones[index]?.cantidad ?? 1)
      const nextCantidad = clampCantidad(currentCantidad, maxCantidad)

      setValue(`refacciones.${index}.nombre_refaccion`, item.nombre)
      setValue(`refacciones.${index}.precio_unitario`, item.precio_unitario ?? 0)
      setValue(`refacciones.${index}.inventario_id`, item.id)
      setValue(`refacciones.${index}.cantidad`, nextCantidad, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }

  const getMaxCantidad = (index: number, inventarioId?: number | null): number | null => {
    if (!inventarioId) return null

    const source = normalizeRefaccionSource(refacciones[index]?.inventory_source)
    return getMaxCantidadForSource(inventarioId, source, index)
  }

  const clampCantidad = (value: number, maxCantidad: number | null): number => {
    const normalized = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1
    return typeof maxCantidad === 'number' ? Math.min(normalized, maxCantidad) : normalized
  }

  const handleCantidadChange = (index: number, rawValue: string) => {
    const inventarioId = refacciones[index]?.inventario_id
    const maxCantidad = getMaxCantidad(index, inventarioId)
    const parsed = rawValue === '' ? Number.NaN : Number(rawValue)
    const nextCantidad = clampCantidad(parsed, maxCantidad)

    setValue(`refacciones.${index}.cantidad`, nextCantidad, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleAddRefaccion = () => {
    if (!requireCatalogSelection) {
      append({ nombre_refaccion: '', cantidad: 1, precio_unitario: 0, inventario_id: null, inventory_source: 'general' })
      return
    }

    const nextItem = getNextAddableInventoryItem()
    if (!nextItem) return

    append({
      inventario_id: nextItem.id,
      nombre_refaccion: nextItem.nombre,
      cantidad: 1,
      precio_unitario: nextItem.precio_unitario ?? 0,
      inventory_source: 'general',
    })
  }

  const canAddRefaccion = !requireCatalogSelection || Boolean(getNextAddableInventoryItem())

  const content = (
    <>
      <div className="space-y-3">
        {fields.map((field, index) => {
          const selectedInventarioId = refacciones[index]?.inventario_id
          const maxCantidad = getMaxCantidad(index, selectedInventarioId)
          const inventarioOptions = inventario.flatMap((item) => {
            const optionMaxCantidad = getMaxCantidad(index, item.id)
            const isCurrentSelection = selectedInventarioId === item.id

            if (!isCurrentSelection && isSelectedInOtherRow(index, item.id)) {
              return []
            }

            if (!isCurrentSelection && Number(optionMaxCantidad ?? 0) <= 0) {
              return []
            }

            return [{
              item,
              maxCantidad: optionMaxCantidad,
              disabled: false,
            } satisfies InventarioOption]
          })

          return (
          <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
            <input type="hidden" {...register(`refacciones.${index}.inventory_source`)} />

            {/* Seleccionar del catálogo */}
            <div className="col-span-4">
              {index === 0 && (
                <Label className="mb-1.5 block text-xs">
                  {requireCatalogSelection ? 'Refacción *' : 'Del catálogo (opc.)'}
                </Label>
              )}
              <InventarioCombobox
                value={refacciones[index]?.inventario_id ?? null}
                options={inventarioOptions}
                onChange={(inventarioId) => handleSelectInventario(index, inventarioId)}
                placeholder={requireCatalogSelection ? 'Selecciona una refacción' : 'Buscar en catálogo'}
                allowClear={!requireCatalogSelection}
              />
            </div>

            {/* Nombre */}
            <div className="col-span-3">
              {index === 0 && <Label className="mb-1.5 block text-xs">Nombre *</Label>}
              <Input
                {...register(`refacciones.${index}.nombre_refaccion`)}
                placeholder={requireCatalogSelection ? 'Se llena desde inventario' : 'Nombre de la pieza'}
                className={`text-sm ${requireCatalogSelection ? 'bg-slate-50 text-slate-500' : ''}`}
                readOnly={requireCatalogSelection}
              />
            </div>

            {/* Cantidad */}
            <div className="col-span-2">
              {index === 0 && <Label className="mb-1.5 block text-xs">Cant. *</Label>}
              <Input
                type="number"
                min="1"
                max={maxCantidad ?? undefined}
                value={refacciones[index]?.cantidad ?? 1}
                onChange={(event) => handleCantidadChange(index, event.target.value)}
                className="text-sm"
              />
            </div>

            {/* Precio */}
            <div className="col-span-2">
              {index === 0 && <Label className="mb-1.5 block text-xs">P.U. *</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register(`refacciones.${index}.precio_unitario`, { valueAsNumber: true })}
                className="text-sm"
              />
            </div>

            {/* Eliminar */}
            <div className="col-span-1 flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(index)}
                className="h-9 w-9 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          )
        })}
      </div>

      {errors.refacciones && typeof errors.refacciones.message === 'string' && (
        <p className="text-xs text-destructive">{errors.refacciones.message}</p>
      )}
      {Array.isArray(errors.refacciones) && errors.refacciones.some(Boolean) && (
        <p className="text-xs text-destructive">Cada refacción debe seleccionarse desde el inventario.</p>
      )}

      <div className="flex items-center justify-between">
        {canAddRefaccion ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleAddRefaccion}
          >
            <Plus className="h-4 w-4" />
            Agregar refacción
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled
                >
                  <Plus className="h-4 w-4" />
                  Agregar refacción
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              No hay más refacciones disponibles en el inventario
            </TooltipContent>
          </Tooltip>
        )}

        <div className="text-sm font-semibold text-ran-navy">
          Total: {formatMXN(totalRefacciones)}
        </div>
      </div>

      {showSubmitButton && (
        <Button type="submit" disabled={isLoading} className="w-full bg-ran-navy hover:bg-ran-navy/90">
          {isLoading ? 'Guardando…' : 'Guardar refacciones'}
        </Button>
      )}
    </>
  )

  if (!showSubmitButton) {
    return <div className="space-y-4">{content}</div>
  }

  return (
    <form onSubmit={handleSubmit((d) => onSubmit(d.refacciones))} className="space-y-4">
      {content}
    </form>
  )
}
