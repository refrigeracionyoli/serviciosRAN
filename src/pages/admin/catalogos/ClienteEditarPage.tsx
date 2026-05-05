import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Plus, Unlink } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { AdminPageLoadingSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { Badge } from '@/components/ui/badge'
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
import { useToast } from '@/hooks/use-toast'
import { useClienteDetalleQuery, useClientesQuery, useEditarClienteMutation } from '@/hooks/use-clientes'
import { useActualizarMaquinaMutation, useCrearMaquinaMutation, useMaquinasQuery } from '@/hooks/use-maquinas'
import { getSpanishErrorMessage } from '@/lib/error-messages'
import { isLikelyUniqueViolation } from '@/lib/offline/network'
import { crearClienteSchema, type CrearClienteInput } from '@/schemas/cliente.schema'
import type { Maquina } from '@/types/domain.types'

interface MaquinaFormState {
  serie: string
  modelo: string
  fecha_instalacion: string
  observaciones: string
}

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

function normalizeSerie(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function appendMachineNote(current: string | null | undefined, note: string): string {
  const base = String(current ?? '').trim()
  return base ? `${base}\n${note}` : note
}

function getTodayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function ClienteEditarPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { id } = useParams<{ id: string }>()
  const [isCheckingCodigo, setIsCheckingCodigo] = useState(false)
  const [maquinaForm, setMaquinaForm] = useState<MaquinaFormState>({
    serie: '',
    modelo: '',
    fecha_instalacion: '',
    observaciones: '',
  })
  const [maquinaToDetach, setMaquinaToDetach] = useState<Maquina | null>(null)

  const clienteId = Number(id)
  const clienteIdValido = Number.isFinite(clienteId) ? clienteId : undefined

  const { data: cliente, isLoading } = useClienteDetalleQuery(clienteIdValido)
  const { data: clientes = [], refetch: refetchClientes } = useClientesQuery({ includeInactive: true })
  const { data: maquinasCatalogo = [], isLoading: loadingMaquinas } = useMaquinasQuery({ includeInactive: true })
  const { mutateAsync: editarClienteAsync, isPending } = useEditarClienteMutation()
  const { mutateAsync: crearMaquinaAsync, isPending: isCreatingMaquina } = useCrearMaquinaMutation()
  const { mutateAsync: actualizarMaquinaAsync, isPending: isUpdatingMaquina } = useActualizarMaquinaMutation()

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

  const maquinasCliente = useMemo(() => {
    if (!clienteIdValido) return []

    return maquinasCatalogo
      .filter((maquina) => maquina.cliente_id === clienteIdValido)
      .sort((left, right) => left.serie.localeCompare(right.serie, 'es', { sensitivity: 'base' }))
  }, [clienteIdValido, maquinasCatalogo])

  const modelosMaquina = useMemo(() => {
    return Array.from(new Set(maquinasCatalogo
      .map((maquina) => maquina.modelo.trim())
      .filter((modelo) => modelo.length > 0)))
      .sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }))
  }, [maquinasCatalogo])

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

  const handleCreateMaquina = async () => {
    if (!clienteIdValido) return

    const serie = maquinaForm.serie.trim()
    const modelo = maquinaForm.modelo.trim()
    if (serie.length < 3) {
      toast({
        title: 'Serie inválida',
        description: 'La serie de la máquina debe tener al menos 3 caracteres.',
        variant: 'destructive',
      })
      return
    }
    if (!modelo) {
      toast({
        title: 'Modelo requerido',
        description: 'Ingresa el modelo de la máquina para agregarla al cliente.',
        variant: 'destructive',
      })
      return
    }

    const existing = maquinasCatalogo.find((maquina) => normalizeSerie(maquina.serie) === normalizeSerie(serie))
    if (existing?.cliente_id === clienteIdValido) {
      toast({
        title: 'Máquina ya registrada',
        description: 'Esa serie ya pertenece a este cliente.',
      })
      return
    }
    if (existing?.cliente_id != null) {
      toast({
        title: 'Máquina asignada a otro cliente',
        description: 'Primero desvincula esa máquina de su cliente actual antes de asignarla aquí.',
        variant: 'destructive',
      })
      return
    }

    try {
      if (existing) {
        await actualizarMaquinaAsync({
          id: existing.id,
          data: {
            cliente_id: clienteIdValido,
            status: 'operando',
            activo: true,
            observaciones: toNullable(maquinaForm.observaciones) ?? existing.observaciones,
          },
        })
      } else {
        await crearMaquinaAsync({
          serie,
          modelo,
          cliente_id: clienteIdValido,
          fecha_instalacion: toNullable(maquinaForm.fecha_instalacion),
          status: 'operando',
          observaciones: toNullable(maquinaForm.observaciones),
          activo: true,
        })
      }

      setMaquinaForm({ serie: '', modelo: '', fecha_instalacion: '', observaciones: '' })
      toast({
        title: existing ? 'Máquina asignada' : 'Máquina agregada',
        description: 'El catálogo del cliente fue actualizado correctamente.',
      })
    } catch (error) {
      toast({
        title: 'Error al guardar máquina',
        description: getSpanishErrorMessage(error, 'No se pudo actualizar el catálogo de máquinas.'),
        variant: 'destructive',
      })
    }
  }

  const handleDetachMachine = async () => {
    if (!maquinaToDetach) return

    try {
      await actualizarMaquinaAsync({
        id: maquinaToDetach.id,
        data: {
          cliente_id: null,
          status: 'baja',
          activo: false,
          observaciones: appendMachineNote(
            maquinaToDetach.observaciones,
            `Desvinculada manualmente del cliente ${cliente?.codigo_cliente ?? clienteIdValido ?? ''} el ${getTodayIsoDate()}.`,
          ),
        },
      })
      toast({
        title: 'Máquina desvinculada',
        description: 'La máquina ya no aparecerá como parte de este cliente.',
      })
      setMaquinaToDetach(null)
    } catch (error) {
      toast({
        title: 'Error al desvincular máquina',
        description: getSpanishErrorMessage(error, 'No se pudo desvincular la máquina.'),
        variant: 'destructive',
      })
    }
  }

  const isSaving = isPending || isCheckingCodigo
  const isMachineSaving = isCreatingMaquina || isUpdatingMaquina

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

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ran-navy">Máquinas del cliente</h2>
            <p className="mt-1 text-sm text-ran-slate">
              Administra correcciones del catálogo sin crear una orden de instalación o retiro.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-ran-blue/20 bg-ran-blue/10 text-ran-blue">
            {maquinasCliente.length} máquina(s)
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <HorizontalScrollArea>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-4 py-3">Serie</th>
                    <th className="px-3 py-3">Modelo</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Instalación</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMaquinas && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4">
                        <AdminTableSkeleton rows={4} columns={5} />
                      </td>
                    </tr>
                  )}
                  {!loadingMaquinas && maquinasCliente.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-ran-slate">
                        Este cliente no tiene máquinas asignadas.
                      </td>
                    </tr>
                  )}
                  {!loadingMaquinas && maquinasCliente.map((maquina) => (
                    <tr key={maquina.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-4 py-3.5 font-mono font-semibold text-ran-navy">{maquina.serie}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{maquina.modelo}</td>
                      <td className="px-3 py-3.5">
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-ran-slate">
                          {maquina.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 text-ran-slate">{maquina.fecha_instalacion ?? '—'}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-lg border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => setMaquinaToDetach(maquina)}
                          disabled={isMachineSaving}
                        >
                          <Unlink className="h-4 w-4" />
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </div>

          <div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="text-base font-bold text-ran-navy">Agregar nueva máquina</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="maquina-serie" className="mb-1.5 block">Serie</Label>
                  <Input
                    id="maquina-serie"
                    value={maquinaForm.serie}
                    onChange={(event) => setMaquinaForm((prev) => ({ ...prev, serie: event.target.value }))}
                    className="h-11 rounded-xl"
                    placeholder="Ej: E00283B"
                  />
                </div>
                <div>
                  <Label htmlFor="maquina-modelo" className="mb-1.5 block">Modelo</Label>
                  <Input
                    id="maquina-modelo"
                    list="cliente-editar-modelos-maquina"
                    value={maquinaForm.modelo}
                    onChange={(event) => setMaquinaForm((prev) => ({ ...prev, modelo: event.target.value }))}
                    className="h-11 rounded-xl"
                    placeholder="Escribe o elige un modelo"
                  />
                  <datalist id="cliente-editar-modelos-maquina">
                    {modelosMaquina.map((modelo) => (
                      <option key={modelo} value={modelo} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="mt-3">
                <Label className="mb-1.5 block">Fecha instalación</Label>
                <DatePickerInput
                  value={maquinaForm.fecha_instalacion}
                  onChange={(value) => setMaquinaForm((prev) => ({ ...prev, fecha_instalacion: value ?? '' }))}
                  placeholder="Seleccionar fecha"
                  allowClear
                />
              </div>
              <div className="mt-3">
                <Label htmlFor="maquina-observaciones" className="mb-1.5 block">Observaciones</Label>
                <textarea
                  id="maquina-observaciones"
                  value={maquinaForm.observaciones}
                  onChange={(event) => setMaquinaForm((prev) => ({ ...prev, observaciones: event.target.value }))}
                  rows={2}
                  className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="Notas internas de la máquina"
                />
              </div>
              <Button
                type="button"
                className="mt-3 h-11 w-full rounded-xl bg-ran-navy text-base font-semibold hover:bg-ran-navy/90"
                onClick={() => void handleCreateMaquina()}
                disabled={isMachineSaving}
              >
                <Plus className="h-4 w-4" />
                {isMachineSaving ? 'Guardando...' : 'Agregar máquina'}
              </Button>
            </div>

          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(maquinaToDetach)}
        onOpenChange={(open) => {
          if (!open) setMaquinaToDetach(null)
        }}
        title="Quitar máquina del cliente"
        description={maquinaToDetach
          ? `La máquina ${maquinaToDetach.serie} quedará en baja y sin cliente asignado. El historial de servicios no se eliminará.`
          : 'La máquina quedará en baja y sin cliente asignado.'}
        confirmLabel="Quitar máquina"
        variant="destructive"
        isLoading={isUpdatingMaquina}
        onConfirm={() => void handleDetachMachine()}
      />
    </div>
  )
}
