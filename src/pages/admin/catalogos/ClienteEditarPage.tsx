import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
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
import { AdminPageLoadingSkeleton } from '@/components/shared/AdminSkeletons'
import { useToast } from '@/hooks/use-toast'
import { useClienteDetalleQuery, useClientesQuery, useEditarClienteMutation } from '@/hooks/use-clientes'
import { isLikelyUniqueViolation } from '@/lib/offline/network'
import { crearClienteSchema, type CrearClienteInput } from '@/schemas/cliente.schema'

function toNullable(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function normalizeCodigoCliente(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim()
}

function sanitizeCodigoClienteInput(value: string): string {
  return value.replace(/\D+/g, '')
}

export function ClienteEditarPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { id } = useParams<{ id: string }>()
  const [isCheckingCodigo, setIsCheckingCodigo] = useState(false)

  const clienteId = Number(id)
  const clienteIdValido = Number.isFinite(clienteId) ? clienteId : undefined

  const { data: cliente, isLoading } = useClienteDetalleQuery(clienteIdValido)
  const { data: clientes = [], refetch: refetchClientes } = useClientesQuery({ includeInactive: true })
  const { mutateAsync: editarClienteAsync, isPending } = useEditarClienteMutation()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    setError,
    clearErrors,
    getFieldState,
    formState: { errors, isDirty },
  } = useForm<CrearClienteInput>({
    resolver: zodResolver(crearClienteSchema),
    defaultValues: {
      codigo_cliente: '',
      nombre: '',
      direccion: '',
      municipio: '',
      telefono: '',
      correo_contacto: '',
      activo: true,
    },
  })

  useEffect(() => {
    if (!cliente) return

    reset({
      codigo_cliente: cliente.codigo_cliente,
      nombre: cliente.nombre,
      direccion: cliente.direccion ?? '',
      municipio: cliente.municipio ?? '',
      telefono: cliente.telefono ?? '',
      correo_contacto: cliente.correo_contacto ?? '',
      activo: cliente.activo,
    })
  }, [cliente, reset])

  const validateCodigoClienteDuplicado = async (codigoCliente: string): Promise<boolean> => {
    if (!clienteIdValido) return false

    const normalizedCodigo = normalizeCodigoCliente(codigoCliente)
    if (!normalizedCodigo) return false

    const codigoActual = normalizeCodigoCliente(cliente?.codigo_cliente)
    if (normalizedCodigo === codigoActual) {
      if (getFieldState('codigo_cliente').error?.type === 'manual') {
        clearErrors('codigo_cliente')
      }
      return false
    }

    setIsCheckingCodigo(true)
    try {
      const refreshed = await refetchClientes()
      const dataset = refreshed.data ?? clientes
      const duplicated = dataset.find((item) => (
        item.id !== clienteIdValido
        && normalizeCodigoCliente(item.codigo_cliente) === normalizedCodigo
      ))

      if (duplicated) {
        setError('codigo_cliente', {
          type: 'manual',
          message: `El código ${normalizedCodigo} ya está registrado para otro cliente.`,
        })
        return true
      }

      if (getFieldState('codigo_cliente').error?.type === 'manual') {
        clearErrors('codigo_cliente')
      }
      return false
    } finally {
      setIsCheckingCodigo(false)
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    if (!clienteIdValido) return

    const normalizedCodigo = normalizeCodigoCliente(data.codigo_cliente)
    const hasDuplicatedCodigo = await validateCodigoClienteDuplicado(normalizedCodigo)
    if (hasDuplicatedCodigo) return

    try {
      await editarClienteAsync({
        id: clienteIdValido,
        data: {
          codigo_cliente: normalizedCodigo,
          nombre: data.nombre.trim(),
          direccion: toNullable(data.direccion),
          municipio: toNullable(data.municipio),
          telefono: toNullable(data.telefono),
          correo_contacto: toNullable(data.correo_contacto),
          activo: data.activo,
        },
      })

      toast({
        title: 'Cliente actualizado',
        description: 'Los cambios fueron guardados correctamente.',
      })

      navigate(`/catalogos/clientes/${clienteIdValido}`, { replace: true })
    } catch (error) {
      if (isLikelyUniqueViolation(error)) {
        setError('codigo_cliente', {
          type: 'manual',
          message: `El código ${normalizedCodigo} ya está registrado para otro cliente.`,
        })
      }

      toast({
        title: 'Error al actualizar cliente',
        description: isLikelyUniqueViolation(error)
          ? `No se guardaron los cambios porque el código ${normalizedCodigo} ya existe.`
          : error instanceof Error ? error.message : 'No se pudo guardar la información.',
        variant: 'destructive',
      })
    }
  })

  const isSaving = isPending || isCheckingCodigo

  if (isLoading) {
    return <AdminPageLoadingSkeleton />
  }

  if (!cliente) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          No se encontró el cliente solicitado.
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate('/catalogos')}>
              Volver a catálogos
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(`/catalogos/clientes/${cliente.id}`)}
          className="rounded-lg border border-slate-200 bg-white p-2 text-ran-slate transition-colors hover:bg-ran-ice hover:text-ran-navy"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <AdminBreadcrumbs items={['Catálogos', 'Clientes', cliente.nombre, 'Editar']} className="mb-0" />
      </div>

      <div className="mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Editar cliente</h1>
        <p className="mt-1 text-lg text-ran-slate">Actualiza la información del establecimiento</p>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <section>
          <h2 className="text-2xl font-bold text-ran-navy">Datos del establecimiento</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_0.48fr]">
            <div>
              <Label htmlFor="nombre" className="mb-1.5 block">Nombre del establecimiento</Label>
              <Input id="nombre" className="h-11 rounded-xl" {...register('nombre')} />
              {errors.nombre && <p className="mt-1 text-xs text-destructive">{errors.nombre.message}</p>}
            </div>
            <div>
              <Label htmlFor="codigo_cliente" className="mb-1.5 block">Código cliente</Label>
              <Input
                id="codigo_cliente"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                className="h-11 rounded-xl"
                {...register('codigo_cliente', {
                  onBlur: (event) => {
                    void validateCodigoClienteDuplicado(event.target.value)
                  },
                  onChange: (event) => {
                    event.target.value = sanitizeCodigoClienteInput(event.target.value)
                    if (getFieldState('codigo_cliente').error?.type === 'manual') {
                      clearErrors('codigo_cliente')
                    }
                  },
                })}
              />
              {errors.codigo_cliente && <p className="mt-1 text-xs text-destructive">{errors.codigo_cliente.message}</p>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div>
              <Label htmlFor="direccion" className="mb-1.5 block">Dirección</Label>
              <Input id="direccion" className="h-11 rounded-xl" {...register('direccion')} />
              {errors.direccion && <p className="mt-1 text-xs text-destructive">{errors.direccion.message}</p>}
            </div>
            <div>
              <Label htmlFor="municipio" className="mb-1.5 block">Municipio</Label>
              <Input id="municipio" className="h-11 rounded-xl" {...register('municipio')} />
              {errors.municipio && <p className="mt-1 text-xs text-destructive">{errors.municipio.message}</p>}
            </div>
            <div>
              <Label htmlFor="telefono" className="mb-1.5 block">Teléfono</Label>
              <Input id="telefono" className="h-11 rounded-xl" {...register('telefono')} />
              {errors.telefono && <p className="mt-1 text-xs text-destructive">{errors.telefono.message}</p>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_0.34fr]">
            <div>
              <Label htmlFor="correo_contacto" className="mb-1.5 block">Correo del supervisor</Label>
              <Input
                id="correo_contacto"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="h-11 rounded-xl"
                {...register('correo_contacto')}
              />
              {errors.correo_contacto && <p className="mt-1 text-xs text-destructive">{errors.correo_contacto.message}</p>}
            </div>
            <div>
              <Label htmlFor="activo" className="mb-1.5 block">Status</Label>
              <Select
                value={watch('activo') ? 'activo' : 'inactivo'}
                onValueChange={(value) => setValue('activo', value === 'activo', { shouldDirty: true })}
              >
                <SelectTrigger id="activo" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl px-8"
            onClick={() => navigate(`/catalogos/clientes/${cliente.id}`)}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="h-11 rounded-xl bg-ran-navy px-8 text-base font-semibold hover:bg-ran-navy/90"
            disabled={isSaving || !isDirty}
          >
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  )
}
