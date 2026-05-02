import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
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
import { useClientesQuery, useCrearClienteMutation } from '@/hooks/use-clientes'
import { useCrearMaquinaMutation, useMaquinasQuery } from '@/hooks/use-maquinas'
import { getSpanishErrorMessage } from '@/lib/error-messages'
import { crearClienteSchema, type CrearClienteInput } from '@/schemas/cliente.schema'

interface ClienteCodigoLookup {
  id: number
  codigo_cliente: string
}

interface MaquinaFormState {
  serie: string
  modelo: string
  fecha_instalacion: string
}

interface ClienteNuevoLocationState {
  source?: 'servicio-nuevo'
  returnTo?: string
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

function findClienteDuplicadoByCodigo(
  clientes: ClienteCodigoLookup[],
  codigoCliente: string,
): ClienteCodigoLookup | null {
  const normalized = normalizeCodigoCliente(codigoCliente)
  if (!normalized) return null

  return clientes.find((cliente) => normalizeCodigoCliente(cliente.codigo_cliente) === normalized) ?? null
}

export function ClienteNuevoPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const locationState = (location.state as ClienteNuevoLocationState | null) ?? null
  const fromServicioNuevo = locationState?.source === 'servicio-nuevo'
  const returnTo = typeof locationState?.returnTo === 'string' ? locationState.returnTo : null

  const [colonia, setColonia] = useState('')
  const [notas, setNotas] = useState('')
  const [isCheckingCodigo, setIsCheckingCodigo] = useState(false)
  const [maquina, setMaquina] = useState<MaquinaFormState>({
    serie: '',
    modelo: '',
    fecha_instalacion: '',
  })

  const { data: clientes = [], refetch: refetchClientes } = useClientesQuery({ includeInactive: true })
  const { data: maquinas = [] } = useMaquinasQuery({ includeInactive: true })
  const { mutateAsync: crearClienteAsync, isPending: isCreatingCliente } = useCrearClienteMutation()
  const { mutateAsync: crearMaquinaAsync, isPending: isCreatingMaquina } = useCrearMaquinaMutation()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    getFieldState,
    formState: { errors },
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

  const modelosMaquina = useMemo(() => {
    return Array.from(new Set(maquinas
      .map((item) => item.modelo.trim())
      .filter((value) => value.length > 0)))
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [maquinas])

  const isSaving = isCreatingCliente || isCreatingMaquina || isCheckingCodigo

  const previewNombre = watch('nombre') || '—'
  const previewCodigo = watch('codigo_cliente') || '—'
  const previewMunicipio = watch('municipio') || '—'
  const previewStatus = watch('activo') ? 'Activo' : 'Inactivo'

  const navigateAfterCreate = (selectedClienteId?: number) => {
    if (returnTo) {
      navigate(returnTo, {
        replace: true,
        state: typeof selectedClienteId === 'number'
          ? { source: 'cliente-nuevo', selectedClienteId }
          : undefined,
      })
      return
    }

    navigate('/catalogos', { replace: true })
  }

  const validateCodigoClienteDuplicado = async (codigoCliente: string): Promise<boolean> => {
    const normalizedCodigo = normalizeCodigoCliente(codigoCliente)
    if (!normalizedCodigo) return false

    setIsCheckingCodigo(true)
    try {
      const refreshed = await refetchClientes()
      const dataset = refreshed.data ?? clientes
      const duplicated = findClienteDuplicadoByCodigo(dataset, normalizedCodigo)

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
    try {
      const normalizedCodigo = normalizeCodigoCliente(data.codigo_cliente)
      const hasDuplicatedCodigo = await validateCodigoClienteDuplicado(normalizedCodigo)
      if (hasDuplicatedCodigo) {
        return
      }

      const machineSerie = maquina.serie.trim()
      const shouldCreateMachine = machineSerie.length > 0
      const machineModelo = maquina.modelo.trim()

      if (shouldCreateMachine && machineSerie.length < 3) {
        throw new Error('La serie de la máquina debe tener al menos 3 caracteres.')
      }
      if (shouldCreateMachine && machineModelo.length === 0) {
        throw new Error('Ingresa el modelo de la máquina para continuar.')
      }

      const direccionBase = toNullable(data.direccion)
      const coloniaValue = toNullable(colonia)
      const direccionFinal = direccionBase && coloniaValue
        ? `${direccionBase} · Col. ${coloniaValue}`
        : direccionBase ?? (coloniaValue ? `Col. ${coloniaValue}` : null)

      const createdCliente = await crearClienteAsync({
        ...data,
        codigo_cliente: normalizedCodigo,
        nombre: data.nombre.trim(),
        direccion: direccionFinal,
        municipio: toNullable(data.municipio),
        telefono: toNullable(data.telefono),
        correo_contacto: toNullable(data.correo_contacto),
      })

      if (shouldCreateMachine) {
        await crearMaquinaAsync({
          serie: machineSerie,
          modelo: machineModelo,
          cliente_id: createdCliente.id,
          fecha_instalacion: toNullable(maquina.fecha_instalacion),
          status: 'operando',
          observaciones: toNullable(notas),
          activo: true,
        })
      }

      toast({
        title: 'Cliente registrado',
        description: shouldCreateMachine
          ? 'El cliente y su máquina inicial fueron guardados correctamente.'
          : 'El cliente fue guardado correctamente.',
      })

      navigateAfterCreate(createdCliente.id)
    } catch (error) {
      toast({
        title: 'Error al registrar cliente',
        description: getSpanishErrorMessage(error, 'No se pudo guardar la información.'),
        variant: 'destructive',
      })
    }
  })

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigateAfterCreate()}
          className="rounded-lg border border-slate-200 bg-white p-2 text-ran-slate transition-colors hover:bg-ran-ice hover:text-ran-navy"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <AdminBreadcrumbs
          items={fromServicioNuevo
            ? ['Servicios', 'Nuevo servicio', 'Nuevo cliente']
            : ['Catálogos', 'Clientes', 'Nuevo cliente']}
          className="mb-0"
        />
      </div>

      <div className="mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Nuevo cliente</h1>
        <p className="mt-1 text-lg text-ran-slate">
          {fromServicioNuevo
            ? 'Registra un establecimiento para continuar con el nuevo servicio'
            : 'Registra un establecimiento en el catálogo de clientes'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <section>
          <h2 className="text-2xl font-bold text-ran-navy">1. Datos del establecimiento</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_0.48fr]">
            <div>
              <Label htmlFor="nombre" className="mb-1.5 block">Nombre del establecimiento</Label>
              <Input id="nombre" placeholder="Ej: Tkt Six Centenario" className="h-11 rounded-xl" {...register('nombre')} />
              {errors.nombre && <p className="mt-1 text-xs text-destructive">{errors.nombre.message}</p>}
            </div>
            <div>
              <Label htmlFor="codigo_cliente" className="mb-1.5 block">Código cliente</Label>
              <Input
                id="codigo_cliente"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="Ej: 300831815"
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
              <Input id="direccion" placeholder="Calle, número exterior" className="h-11 rounded-xl" {...register('direccion')} />
              {errors.direccion && <p className="mt-1 text-xs text-destructive">{errors.direccion.message}</p>}
            </div>
            <div>
              <Label htmlFor="colonia" className="mb-1.5 block">Colonia</Label>
              <Input
                id="colonia"
                value={colonia}
                onChange={(event) => setColonia(event.target.value)}
                placeholder="Ej: Obrerista"
                className="h-11 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="municipio" className="mb-1.5 block">Municipio</Label>
              <Input id="municipio" placeholder="Ej: Monterrey" className="h-11 rounded-xl" {...register('municipio')} />
              {errors.municipio && <p className="mt-1 text-xs text-destructive">{errors.municipio.message}</p>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[0.48fr_0.74fr_0.34fr]">
            <div>
              <Label htmlFor="telefono" className="mb-1.5 block">Teléfono</Label>
              <Input id="telefono" placeholder="Ej: 8112399016" className="h-11 rounded-xl" {...register('telefono')} />
              {errors.telefono && <p className="mt-1 text-xs text-destructive">{errors.telefono.message}</p>}
            </div>
            <div>
              <Label htmlFor="correo_contacto" className="mb-1.5 block">Correo del supervisor</Label>
              <Input
                id="correo_contacto"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Ej: supervisor@cliente.com"
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

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-2xl font-bold text-ran-navy">2. Máquina instalada</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[0.62fr_0.62fr_0.42fr]">
            <div>
              <Label htmlFor="serie" className="mb-1.5 block">No. de serie</Label>
              <Input
                id="serie"
                value={maquina.serie}
                onChange={(event) => setMaquina((prev) => ({ ...prev, serie: event.target.value }))}
                placeholder="Ej: E00283B"
                className="h-11 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="modelo" className="mb-1.5 block">Modelo</Label>
              <Input
                id="modelo"
                list="modelo-maquina-options"
                value={maquina.modelo}
                onChange={(event) => setMaquina((prev) => ({ ...prev, modelo: event.target.value }))}
                placeholder="Escribe o elige un modelo"
                className="h-11 rounded-xl"
              />
              <datalist id="modelo-maquina-options">
                {modelosMaquina.map((modelo) => (
                  <option key={modelo} value={modelo} />
                ))}
              </datalist>
            </div>
            <div>
              <Label className="mb-1.5 block">Fecha instalación</Label>
              <DatePickerInput
                value={maquina.fecha_instalacion}
                onChange={(value) => setMaquina((prev) => ({ ...prev, fecha_instalacion: value ?? '' }))}
                placeholder="Seleccionar fecha de instalación"
                allowClear
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-ran-slate">Puedes agregar más máquinas desde el detalle del cliente.</p>
        </section>

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-2xl font-bold text-ran-navy">3. Observaciones</h2>
          <div className="mt-3">
            <Label htmlFor="notas" className="mb-1.5 block">Notas</Label>
            <textarea
              id="notas"
              value={notas}
              onChange={(event) => setNotas(event.target.value)}
              rows={3}
              placeholder="Acceso, horarios, indicaciones especiales, portafiltros, etc. (opcional)"
              className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 text-xs text-ran-slate lg:grid-cols-6">
            <div className="min-w-0">
              <p className="font-semibold uppercase">Establecimiento</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={previewNombre}>{previewNombre}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase">Código</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={previewCodigo}>{previewCodigo}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase">Municipio</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={previewMunicipio}>{previewMunicipio}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase">Serie</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={maquina.serie || '—'}>{maquina.serie || '—'}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase">Modelo</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={maquina.modelo || '—'}>{maquina.modelo || '—'}</p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase">Status</p>
              <p className="mt-0.5 truncate text-sm font-bold text-ran-navy" title={previewStatus}>{previewStatus}</p>
            </div>
          </div>
        </section>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl px-8"
            onClick={() => navigateAfterCreate()}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="h-11 rounded-xl bg-ran-navy px-8 text-base font-semibold hover:bg-ran-navy/90"
            disabled={isSaving}
          >
            {isSaving ? 'Guardando...' : 'Guardar cliente'}
          </Button>
        </div>
      </form>
    </div>
  )
}
