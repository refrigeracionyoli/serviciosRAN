import { useFieldArray, useForm } from 'react-hook-form'
import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { refaccionSchema } from '@/schemas/inventario.schema'
import { formatMXN } from '@/lib/utils'
import { useInventarioQuery } from '@/hooks/use-inventario'

const formSchema = z.object({
  refacciones: z.array(refaccionSchema),
})

type FormValues = z.infer<typeof formSchema>

interface Props {
  onSubmit: (refacciones: z.infer<typeof refaccionSchema>[]) => void
  onChange?: (refacciones: z.infer<typeof refaccionSchema>[]) => void
  isLoading?: boolean
  defaultValues?: z.infer<typeof refaccionSchema>[]
  showSubmitButton?: boolean
}

export function RefaccionesForm({
  onSubmit,
  onChange,
  isLoading,
  defaultValues,
  showSubmitButton = true,
}: Props) {
  const { data: inventario = [] } = useInventarioQuery()

  const { control, register, handleSubmit, watch, setValue, formState: { errors } } =
    useForm<FormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: {
        refacciones: defaultValues ?? [
          { nombre_refaccion: '', cantidad: 1, precio_unitario: 0, inventario_id: null },
        ],
      },
    })

  const { fields, append, remove } = useFieldArray({ control, name: 'refacciones' })
  const refacciones = watch('refacciones')

  // Notificar al padre solo cuando el usuario modifica algo (no en el montaje inicial)
  useEffect(() => {
    if (!onChange) return
    const subscription = watch((values) => {
      if (values.refacciones) {
        onChange(
          values.refacciones.map((item) => ({ ...item })) as z.infer<typeof refaccionSchema>[],
        )
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, onChange])

  const totalRefacciones = refacciones.reduce(
    (sum, r) => sum + (r.cantidad ?? 0) * (r.precio_unitario ?? 0),
    0,
  )

  const handleSelectInventario = (index: number, inventarioId: string) => {
    if (!inventarioId) {
      setValue(`refacciones.${index}.inventario_id`, null)
      return
    }
    const item = inventario.find((i) => i.id.toString() === inventarioId)
    if (item) {
      setValue(`refacciones.${index}.nombre_refaccion`, item.nombre)
      setValue(`refacciones.${index}.precio_unitario`, item.precio_unitario ?? 0)
      setValue(`refacciones.${index}.inventario_id`, item.id)
    }
  }

  return (
    <form onSubmit={handleSubmit((d) => onSubmit(d.refacciones))} className="space-y-4">
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
            {/* Seleccionar del catálogo */}
            <div className="col-span-4">
              {index === 0 && <Label className="mb-1.5 block text-xs">Del catálogo (opc.)</Label>}
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={refacciones[index]?.inventario_id?.toString() ?? ''}
                onChange={(e) => handleSelectInventario(index, e.target.value)}
              >
                <option value="">Buscar en catálogo…</option>
                {inventario.map((item) => (
                  <option key={item.id} value={item.id.toString()}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* Nombre */}
            <div className="col-span-3">
              {index === 0 && <Label className="mb-1.5 block text-xs">Nombre *</Label>}
              <Input
                {...register(`refacciones.${index}.nombre_refaccion`)}
                placeholder="Nombre de la pieza"
                className="text-sm"
              />
            </div>

            {/* Cantidad */}
            <div className="col-span-2">
              {index === 0 && <Label className="mb-1.5 block text-xs">Cant. *</Label>}
              <Input
                type="number"
                min="1"
                {...register(`refacciones.${index}.cantidad`, { valueAsNumber: true })}
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
        ))}
      </div>

      {errors.refacciones && typeof errors.refacciones.message === 'string' && (
        <p className="text-xs text-destructive">{errors.refacciones.message}</p>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() =>
            append({ nombre_refaccion: '', cantidad: 1, precio_unitario: 0, inventario_id: null })
          }
        >
          <Plus className="h-4 w-4" />
          Agregar refacción
        </Button>

        <div className="text-sm font-semibold text-ran-navy">
          Total: ${totalRefacciones.toFixed(2)}
        </div>
      </div>

      {showSubmitButton && (
        <Button type="submit" disabled={isLoading} className="w-full bg-ran-navy hover:bg-ran-navy/90">
          {isLoading ? 'Guardando…' : 'Guardar refacciones'}
        </Button>
      )}
    </form>
  )
}
