import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, ArrowRightLeft, History, MoreVertical, Pencil, Plus, Power, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
} from '@/components/shared/AdminSkeletons'
import { DataTable } from '@/components/shared/DataTable'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  useAjusteInventarioMutation,
  useCrearItemInventarioMutation,
  useEditarItemInventarioMutation,
  useInventarioQuery,
  useToggleItemInventarioActivoMutation,
} from '@/hooks/use-inventario'
import { useToast } from '@/hooks/use-toast'
import {
  ajusteInventarioSchema,
  crearItemInventarioSchema,
  type AjusteInventarioInput,
  type CrearItemInventarioInput,
} from '@/schemas/inventario.schema'
import { formatDate, formatMXN } from '@/lib/utils'
import type { ItemInventario } from '@/types/domain.types'
import { InventarioSubNav } from './InventarioSubNav'

type StockFilter = 'all' | 'stock_bajo' | 'activos' | 'inactivos'

function normalizeInventarioErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/duplicate key|unique/i.test(error.message)) {
      return 'Ya existe un item con ese nombre en inventario.'
    }
    if (/Stock insuficiente/i.test(error.message)) {
      return error.message
    }
    return error.message
  }

  return 'Ocurrió un error al procesar la operación de inventario.'
}

function toNullableText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function toRequiredNumericValue(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) return undefined
    const parsed = Number(normalized)
    return Number.isNaN(parsed) ? Number.NaN : parsed
  }
  return Number.NaN
}

function toOptionalNumericValue(value: unknown): number | null {
  const normalized = toRequiredNumericValue(value)
  return typeof normalized === 'undefined' ? null : normalized
}

export function InventarioPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [openCreateDialog, setOpenCreateDialog] = useState(false)
  const [itemToEdit, setItemToEdit] = useState<ItemInventario | null>(null)
  const [itemToAdjust, setItemToAdjust] = useState<ItemInventario | null>(null)
  const [itemToToggle, setItemToToggle] = useState<ItemInventario | null>(null)

  const { data: inventario = [], isLoading } = useInventarioQuery({ includeInactive: true })
  const { mutate: crearItem, isPending: isCreating } = useCrearItemInventarioMutation()
  const { mutate: editarItem, isPending: isEditing } = useEditarItemInventarioMutation()
  const { mutate: ajustarStock, isPending: isAdjusting } = useAjusteInventarioMutation()
  const { mutate: toggleActivo, isPending: isToggling } = useToggleItemInventarioActivoMutation()
  const isPageLoading = isLoading

  const createForm = useForm<CrearItemInventarioInput>({
    resolver: zodResolver(crearItemInventarioSchema),
    defaultValues: {
      nombre: '',
      descripcion: null,
      stock_actual: 0,
      stock_minimo: 0,
      precio_unitario: null,
      activo: true,
    },
  })

  const editForm = useForm<CrearItemInventarioInput>({
    resolver: zodResolver(crearItemInventarioSchema),
    defaultValues: {
      nombre: '',
      descripcion: null,
      stock_actual: 0,
      stock_minimo: 0,
      precio_unitario: null,
      activo: true,
    },
  })

  const adjustForm = useForm<AjusteInventarioInput>({
    resolver: zodResolver(ajusteInventarioSchema),
    defaultValues: {
      inventario_id: 0,
      tipo: 'entrada',
      cantidad: 1,
      motivo: null,
    },
  })

  useEffect(() => {
    if (!itemToEdit) return

    editForm.reset({
      nombre: itemToEdit.nombre,
      descripcion: itemToEdit.descripcion,
      stock_actual: itemToEdit.stock_actual,
      stock_minimo: itemToEdit.stock_minimo,
      precio_unitario: itemToEdit.precio_unitario,
      activo: itemToEdit.activo,
    })
  }, [editForm, itemToEdit])

  useEffect(() => {
    if (!itemToAdjust) return

    adjustForm.reset({
      inventario_id: itemToAdjust.id,
      tipo: 'entrada',
      cantidad: 1,
      motivo: null,
    })
  }, [adjustForm, itemToAdjust])

  const isBusy = isCreating || isEditing || isAdjusting || isToggling

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return inventario.filter((item) => {
      if (stockFilter === 'activos' && !item.activo) return false
      if (stockFilter === 'inactivos' && item.activo) return false
      if (stockFilter === 'stock_bajo' && (!item.activo || item.stock_actual > item.stock_minimo)) return false

      if (!normalizedSearch) return true

      return [item.nombre, item.descripcion ?? ''].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [inventario, search, stockFilter])

  const stats = useMemo(() => {
    const activos = inventario.filter((item) => item.activo)
    const inactivos = inventario.length - activos.length
    const stockBajo = activos.filter((item) => item.stock_actual <= item.stock_minimo).length
    const valorTotal = activos.reduce((acc, item) => acc + (item.precio_unitario ?? 0) * item.stock_actual, 0)

    return {
      total: inventario.length,
      activos: activos.length,
      inactivos,
      stockBajo,
      valorTotal,
    }
  }, [inventario])

  const columns = useMemo<Array<ColumnDef<ItemInventario>>>(() => {
    return [
      {
        accessorKey: 'nombre',
        header: 'Item',
        cell: ({ row }) => {
          const item = row.original
          const lowStock = item.activo && item.stock_actual <= item.stock_minimo

          return (
            <div>
              <p className="flex items-center gap-2 font-semibold text-ran-navy">
                {item.nombre}
                {lowStock ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : null}
              </p>
              <p className="text-xs text-ran-slate">{item.descripcion ?? 'Sin descripción'}</p>
            </div>
          )
        },
      },
      {
        accessorKey: 'stock_actual',
        header: 'Stock',
        cell: ({ row }) => {
          const item = row.original
          const lowStock = item.activo && item.stock_actual <= item.stock_minimo

          return (
            <div>
              <p className={lowStock ? 'font-bold text-amber-700' : 'font-semibold text-ran-navy'}>{item.stock_actual}</p>
              <p className="text-xs text-ran-slate">Mínimo: {item.stock_minimo}</p>
            </div>
          )
        },
      },
      {
        accessorKey: 'precio_unitario',
        header: 'Precio unitario',
        cell: ({ row }) => row.original.precio_unitario == null ? '—' : formatMXN(row.original.precio_unitario),
      },
      {
        id: 'valor_estimado',
        header: 'Valor estimado',
        cell: ({ row }) => {
          const item = row.original
          const value = (item.precio_unitario ?? 0) * item.stock_actual
          return value > 0 ? formatMXN(value) : '—'
        },
      },
      {
        accessorKey: 'activo',
        header: 'Estado',
        cell: ({ row }) => {
          const item = row.original
          const lowStock = item.activo && item.stock_actual <= item.stock_minimo

          if (!item.activo) {
            return <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">Inactivo</Badge>
          }

          return lowStock
            ? <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700">Stock bajo</Badge>
            : <Badge variant="outline" className="border-green-200 bg-green-100 text-green-800">Activo</Badge>
        },
      },
      {
        accessorKey: 'created_at',
        header: 'Alta',
        cell: ({ row }) => formatDate(row.original.created_at),
      },
      {
        id: 'acciones',
        header: '',
        cell: ({ row }) => {
          const item = row.original

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice"
                  aria-label="Acciones de inventario"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
                <DropdownMenuItem className="cursor-pointer" onClick={() => setItemToEdit(item)}>
                  <Pencil className="h-4 w-4" />
                  Editar item
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setItemToAdjust(item)} disabled={!item.activo}>
                  <ArrowRightLeft className="h-4 w-4" />
                  Ajustar stock
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/inventario/movimientos?item=${item.id}`)}>
                  <History className="h-4 w-4" />
                  Ver movimientos
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setItemToToggle(item)}
                  disabled={isBusy}
                >
                  <Power className="h-4 w-4" />
                  {item.activo ? 'Desactivar' : 'Reactivar'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ]
  }, [isBusy, navigate])

  const handleCreateSubmit = createForm.handleSubmit((values) => {
    if (values.precio_unitario == null) {
      createForm.setError('precio_unitario', {
        type: 'manual',
        message: 'El precio unitario es obligatorio',
      })
      return
    }

    crearItem({
      ...values,
      descripcion: toNullableText(values.descripcion),
      precio_unitario: Number(values.precio_unitario),
      activo: true,
    }, {
      onSuccess: () => {
        toast({
          title: 'Item creado',
          description: `${values.nombre} ya está disponible en el catálogo.`,
        })

        setOpenCreateDialog(false)
        createForm.reset({
          nombre: '',
          descripcion: null,
          stock_actual: 0,
          stock_minimo: 0,
          precio_unitario: null,
          activo: true,
        })
      },
      onError: (error) => {
        toast({
          title: 'Error al crear item',
          description: normalizeInventarioErrorMessage(error),
          variant: 'destructive',
        })
      },
    })
  })

  const handleEditSubmit = editForm.handleSubmit((values) => {
    if (!itemToEdit) return
    if (values.precio_unitario == null) {
      editForm.setError('precio_unitario', {
        type: 'manual',
        message: 'El precio unitario es obligatorio',
      })
      return
    }

    editarItem({
      id: itemToEdit.id,
      data: {
        ...values,
        descripcion: toNullableText(values.descripcion),
        precio_unitario: Number(values.precio_unitario),
        activo: itemToEdit.activo,
      },
    }, {
      onSuccess: () => {
        toast({
          title: 'Item actualizado',
          description: `${values.nombre} se actualizó correctamente.`,
        })
        setItemToEdit(null)
      },
      onError: (error) => {
        toast({
          title: 'Error al actualizar item',
          description: normalizeInventarioErrorMessage(error),
          variant: 'destructive',
        })
      },
    })
  })

  const handleAdjustSubmit = adjustForm.handleSubmit((values) => {
    if (!itemToAdjust) return

    if (values.tipo === 'salida') {
      const stockActual = Number(itemToAdjust.stock_actual ?? 0)

      if (stockActual <= 0) {
        adjustForm.setError('cantidad', {
          type: 'manual',
          message: 'No hay stock disponible para registrar una salida.',
        })
        return
      }

      if (values.cantidad > stockActual) {
        adjustForm.setValue('cantidad', stockActual, {
          shouldDirty: true,
          shouldValidate: true,
        })
        adjustForm.setError('cantidad', {
          type: 'manual',
          message: `Solo hay ${stockActual} pieza(s) disponibles.`,
        })
        return
      }
    }

    ajustarStock({
      ...values,
      inventario_id: itemToAdjust.id,
      motivo: toNullableText(values.motivo),
    }, {
      onSuccess: () => {
        toast({
          title: 'Stock actualizado',
          description: `${itemToAdjust.nombre} quedó actualizado en inventario.`,
        })
        setItemToAdjust(null)
      },
      onError: (error) => {
        toast({
          title: 'Error al ajustar stock',
          description: normalizeInventarioErrorMessage(error),
          variant: 'destructive',
        })
      },
    })
  })

  const handleToggleConfirm = () => {
    if (!itemToToggle) return

    const nextState = !itemToToggle.activo

    toggleActivo({ id: itemToToggle.id, activo: nextState }, {
      onSuccess: () => {
        toast({
          title: nextState ? 'Item reactivado' : 'Item desactivado',
          description: `${itemToToggle.nombre} ${nextState ? 'volvió al catálogo activo' : 'se marcó como inactivo'}.`,
        })
        setItemToToggle(null)
      },
      onError: (error) => {
        toast({
          title: 'Error al actualizar estado',
          description: normalizeInventarioErrorMessage(error),
          variant: 'destructive',
        })
      },
    })
  }

  const adjustTipo = adjustForm.watch('tipo')
  const adjustCantidad = adjustForm.watch('cantidad')
  const isSalidaSinStock = adjustTipo === 'salida' && itemToAdjust != null && Number(itemToAdjust.stock_actual ?? 0) <= 0

  useEffect(() => {
    if (!itemToAdjust || adjustTipo !== 'salida') {
      if (adjustForm.formState.errors.cantidad?.type === 'manual') {
        adjustForm.clearErrors('cantidad')
      }
      return
    }

    const stockActual = Number(itemToAdjust.stock_actual ?? 0)
    const cantidad = Number(adjustCantidad)

    if (stockActual <= 0) {
      adjustForm.setError('cantidad', {
        type: 'manual',
        message: 'No hay stock disponible para registrar una salida.',
      })
      return
    }

    if (Number.isFinite(cantidad) && cantidad > stockActual) {
      adjustForm.setValue('cantidad', stockActual, {
        shouldDirty: true,
        shouldValidate: true,
      })
      adjustForm.setError('cantidad', {
        type: 'manual',
        message: `Solo hay ${stockActual} pieza(s) disponibles.`,
      })
      return
    }

    if (adjustForm.formState.errors.cantidad?.type === 'manual') {
      adjustForm.clearErrors('cantidad')
    }
  }, [adjustCantidad, adjustForm, adjustTipo, itemToAdjust])

  const adjustPreview = (() => {
    if (!itemToAdjust) return null
    if (!Number.isFinite(adjustCantidad)) return itemToAdjust.stock_actual

    if (adjustTipo === 'ajuste') return adjustCantidad
    if (adjustTipo === 'entrada') return itemToAdjust.stock_actual + adjustCantidad
    return Math.max(0, itemToAdjust.stock_actual - adjustCantidad)
  })()

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Inventario</h1>
          <p className="mt-1 text-lg text-ran-slate">Control de catálogo, stock y disponibilidad de refacciones</p>
        </div>
        <div className="flex w-full items-center justify-end gap-3 lg:w-auto">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => navigate('/inventario/movimientos')}
          >
            <History className="h-4 w-4" />
            Movimientos
          </Button>
          <Button onClick={() => setOpenCreateDialog(true)} className="h-11 rounded-xl bg-ran-navy px-5 text-base hover:bg-ran-navy/90">
            <Plus className="h-4 w-4" />
            Nuevo item
          </Button>
        </div>
      </div>

      <InventarioSubNav />

      {isPageLoading ? (
        <>
          <AdminStatsGridSkeleton count={4} className="mb-4" />
          <AdminFilterBarSkeleton className="mb-4 lg:grid-cols-[1.8fr_0.8fr]" items={['', '']} />
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Items en catálogo</p>
              <p className="mt-1 text-2xl font-bold text-ran-navy">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Activos</p>
              <p className="mt-1 text-2xl font-bold text-green-900">{stats.activos}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Stock bajo</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">{stats.stockBajo}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Valor estimado</p>
              <p className="mt-1 text-2xl font-bold text-blue-900">{formatMXN(stats.valorTotal)}</p>
              {stats.inactivos > 0 ? <p className="mt-1 text-xs text-blue-700">Inactivos: {stats.inactivos}</p> : null}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[1.8fr_0.8fr]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o descripción..."
                className="h-11 rounded-xl border-slate-200 pl-10"
              />
            </div>
            <Select value={stockFilter} onValueChange={(value) => setStockFilter(value as StockFilter)}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200">
                <SelectValue placeholder="Filtrar catálogo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="stock_bajo">Solo stock bajo</SelectItem>
                <SelectItem value="activos">Solo activos</SelectItem>
                <SelectItem value="inactivos">Solo inactivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        emptyTitle="Sin items en inventario"
        emptyDescription="No hay registros con los filtros seleccionados."
        pageSize={12}
      />

      <Dialog open={openCreateDialog} onOpenChange={setOpenCreateDialog}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Nuevo item de inventario</DialogTitle>
            <DialogDescription>Captura la información base del catálogo de refacciones.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="crear_nombre">Nombre *</Label>
              <Input id="crear_nombre" placeholder="Ej. Filtro de agua" {...createForm.register('nombre')} />
              {createForm.formState.errors.nombre ? <p className="text-xs text-destructive">{createForm.formState.errors.nombre.message}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="crear_descripcion">Descripción</Label>
              <textarea
                id="crear_descripcion"
                rows={3}
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Descripción opcional de la refacción"
                {...createForm.register('descripcion', {
                  setValueAs: (value: string) => toNullableText(value),
                })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="crear_stock_actual">Stock actual *</Label>
                <Input
                  id="crear_stock_actual"
                  type="number"
                  min={0}
                  step={1}
                  {...createForm.register('stock_actual', {
                    setValueAs: toRequiredNumericValue,
                  })}
                />
                {createForm.formState.errors.stock_actual ? <p className="text-xs text-destructive">{createForm.formState.errors.stock_actual.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crear_stock_minimo">Stock mínimo *</Label>
                <Input
                  id="crear_stock_minimo"
                  type="number"
                  min={0}
                  step={1}
                  {...createForm.register('stock_minimo', {
                    setValueAs: toRequiredNumericValue,
                  })}
                />
                {createForm.formState.errors.stock_minimo ? <p className="text-xs text-destructive">{createForm.formState.errors.stock_minimo.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crear_precio_unitario">Precio unitario *</Label>
                <Input
                  id="crear_precio_unitario"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  {...createForm.register('precio_unitario', {
                    setValueAs: toOptionalNumericValue,
                  })}
                />
                {createForm.formState.errors.precio_unitario ? <p className="text-xs text-destructive">{createForm.formState.errors.precio_unitario.message}</p> : null}
              </div>
            </div>

            <Button type="submit" disabled={isCreating} className="w-full bg-ran-navy hover:bg-ran-navy/90">
              {isCreating ? 'Guardando...' : 'Crear item'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(itemToEdit)} onOpenChange={(open) => !open && setItemToEdit(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Editar item de inventario</DialogTitle>
            <DialogDescription>Actualiza nombre, límites y costo del item seleccionado.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="editar_nombre">Nombre *</Label>
              <Input id="editar_nombre" {...editForm.register('nombre')} />
              {editForm.formState.errors.nombre ? <p className="text-xs text-destructive">{editForm.formState.errors.nombre.message}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editar_descripcion">Descripción</Label>
              <textarea
                id="editar_descripcion"
                rows={3}
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...editForm.register('descripcion', {
                  setValueAs: (value: string) => toNullableText(value),
                })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="editar_stock_actual">Stock actual *</Label>
                <Input
                  id="editar_stock_actual"
                  type="number"
                  min={0}
                  step={1}
                  {...editForm.register('stock_actual', {
                    setValueAs: toRequiredNumericValue,
                  })}
                />
                {editForm.formState.errors.stock_actual ? <p className="text-xs text-destructive">{editForm.formState.errors.stock_actual.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="editar_stock_minimo">Stock mínimo *</Label>
                <Input
                  id="editar_stock_minimo"
                  type="number"
                  min={0}
                  step={1}
                  {...editForm.register('stock_minimo', {
                    setValueAs: toRequiredNumericValue,
                  })}
                />
                {editForm.formState.errors.stock_minimo ? <p className="text-xs text-destructive">{editForm.formState.errors.stock_minimo.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="editar_precio_unitario">Precio unitario *</Label>
                <Input
                  id="editar_precio_unitario"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  {...editForm.register('precio_unitario', {
                    setValueAs: toOptionalNumericValue,
                  })}
                />
                {editForm.formState.errors.precio_unitario ? <p className="text-xs text-destructive">{editForm.formState.errors.precio_unitario.message}</p> : null}
              </div>
            </div>

            <Button type="submit" disabled={isEditing} className="w-full bg-ran-navy hover:bg-ran-navy/90">
              {isEditing ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(itemToAdjust)} onOpenChange={(open) => !open && setItemToAdjust(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Ajustar stock</DialogTitle>
            <DialogDescription>
              {itemToAdjust ? `${itemToAdjust.nombre} · Stock actual: ${itemToAdjust.stock_actual}` : 'Selecciona una operación de stock'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdjustSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo de movimiento *</Label>
              <Select
                value={adjustForm.watch('tipo')}
                onValueChange={(value) => adjustForm.setValue('tipo', value as 'entrada' | 'salida' | 'ajuste', { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="salida">Salida</SelectItem>
                  <SelectItem value="ajuste">Ajuste directo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ajuste_cantidad">Cantidad *</Label>
              <Input
                id="ajuste_cantidad"
                type="number"
                min={1}
                max={adjustTipo === 'salida' && itemToAdjust ? Math.max(1, itemToAdjust.stock_actual) : undefined}
                step={1}
                {...adjustForm.register('cantidad', { valueAsNumber: true })}
              />
              {adjustForm.formState.errors.cantidad ? <p className="text-xs text-destructive">{adjustForm.formState.errors.cantidad.message}</p> : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-ran-slate">
              <p>
                Stock proyectado: <span className={adjustPreview != null && adjustPreview < 0 ? 'font-semibold text-destructive' : 'font-semibold text-ran-navy'}>{adjustPreview ?? '—'}</span>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ajuste_motivo">Motivo</Label>
              <textarea
                id="ajuste_motivo"
                rows={3}
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Ej. Entrada por compra semanal"
                {...adjustForm.register('motivo', {
                  setValueAs: (value: string) => toNullableText(value),
                })}
              />
            </div>

            <Button type="submit" disabled={isAdjusting || isSalidaSinStock} className="w-full bg-ran-navy hover:bg-ran-navy/90">
              {isAdjusting ? 'Aplicando ajuste...' : 'Guardar ajuste'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(itemToToggle)}
        onOpenChange={(open) => {
          if (!open) setItemToToggle(null)
        }}
        title={itemToToggle?.activo ? '¿Desactivar item?' : '¿Reactivar item?'}
        description={
          itemToToggle
            ? itemToToggle.activo
              ? `Se desactivará ${itemToToggle.nombre}. El item no aparecerá para nuevas selecciones hasta reactivarlo.`
              : `Se reactivará ${itemToToggle.nombre} para volver a usarlo en inventario.`
            : 'Confirma la acción.'
        }
        confirmLabel={itemToToggle?.activo ? 'Desactivar' : 'Reactivar'}
        cancelLabel="Cancelar"
        variant={itemToToggle?.activo ? 'destructive' : 'default'}
        onConfirm={handleToggleConfirm}
        isLoading={isToggling}
      />
    </div>
  )
}
