import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, FileText, ImagePlus, Plus, Trash2, UploadCloud } from 'lucide-react'
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
import { crearServicioSchema, type CrearServicioInput } from '@/schemas/servicio.schema'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useClientesQuery } from '@/hooks/use-clientes'
import { useCrearClienteMutation } from '@/hooks/use-clientes'
import { useCrearMaquinaMutation } from '@/hooks/use-maquinas'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { formatMXN } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CreatableCombobox } from '@/components/shared/CreatableCombobox'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { useToast } from '@/hooks/use-toast'
import {
  crearClienteSchema,
  crearMaquinaSchema,
  type CrearClienteInput,
  type CrearMaquinaInput,
} from '@/schemas/cliente.schema'
import {
  useEvidenciasQuery,
  useEvidenciaUrlQuery,
  useSubirEvidenciaMutation,
  useEliminarEvidenciaMutation,
} from '@/hooks/use-evidencias'
import { ClienteCombobox } from './ClienteCombobox'
import type { Servicio, Cliente, Cierre, Evidencia } from '@/types/domain.types'

interface Props {
  defaultValues?: Partial<CrearServicioInput>
  onSubmit: (data: CrearServicioInput) => void
  onDraftChange?: (draft: Partial<CrearServicioInput> | null) => void
  clearDraftSignal?: number
  refaccionesContent?: ReactNode
  cierreContent?: ReactNode
  canShowCierre?: boolean
  cierre?: Cierre | null
  isLoading?: boolean
  servicio?: Servicio
  formId?: string
  showSubmitButton?: boolean
  requireTecnicoParaEnRuta?: boolean
  requireFechaServicioParaCompletar?: boolean
}

function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

function buildTaggedFile(file: File, prefix: 'ev-foto' | 'orden-servicio'): File {
  const taggedName = `${prefix}__${Date.now()}__${sanitizeFilename(file.name)}`
  return new File([file], taggedName, { type: file.type })
}

function getDisplayFilename(filename: string): string {
  const parts = filename.split('__')
  if (parts.length >= 3) {
    return parts.slice(2).join('__')
  }
  return filename
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const DEFAULT_TIPOS_SERVICIO = [
  'MTTO CORRECTIVO RUTA',
  'MTTO CORRECTIVO PISO',
  'MTTO PREVENTIVO RUTA',
  'INSTALACION',
  'RETIRO',
  'GARANTIA',
]

const DEFAULT_CLASES_ORDEN = ['ZSM1', 'ZSI2']
const COSTO_MANO_OBRA_DEFAULT = 648

interface TipoServicioDefaults {
  clase_orden: string | null
  costo_mano_obra: number
}

function getTipoServicioDefaults(tipoServicio: string): TipoServicioDefaults {
  const normalized = tipoServicio.trim().toUpperCase()

  if (normalized.includes('INSTALACION') || normalized.includes('RETIRO')) {
    return {
      clase_orden: 'ZSI2',
      costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
    }
  }

  if (normalized.includes('MTTO') || normalized.includes('GARANTIA')) {
    return {
      clase_orden: 'ZSM1',
      costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
    }
  }

  return {
    clase_orden: null,
    costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
  }
}

function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

interface EvidenciaPreview {
  filename: string
  downloadUrl: string
}

interface EvidenciaThumbnailProps {
  evidencia: Evidencia
  disableDelete?: boolean
  onRequestDelete: (evidencia: Evidencia) => void
  onPreview: (preview: EvidenciaPreview) => void
}

function EvidenciaThumbnail({
  evidencia,
  disableDelete = false,
  onRequestDelete,
  onPreview,
}: EvidenciaThumbnailProps) {
  const { data } = useEvidenciaUrlQuery(evidencia.r2_key)
  const downloadUrl = data?.downloadUrl
  const displayFilename = getDisplayFilename(evidencia.filename)

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="block w-full text-left disabled:cursor-not-allowed"
        onClick={() => {
          if (!downloadUrl) return
          onPreview({ filename: displayFilename, downloadUrl })
        }}
        disabled={!downloadUrl}
      >
        <div className="relative h-28 w-full bg-slate-100">
          {downloadUrl ? (
            <img src={downloadUrl} alt={displayFilename} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera className="h-5 w-5 text-slate-400" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
        </div>
      </button>

      <button
        type="button"
        className="absolute right-2 top-2 z-10 rounded-full bg-white/95 p-1.5 text-red-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={(event) => {
          event.stopPropagation()
          onRequestDelete(evidencia)
        }}
        disabled={disableDelete}
        aria-label={`Eliminar ${displayFilename}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <p className="truncate px-2 py-1.5 text-xs text-ran-slate">{displayFilename}</p>
      {disableDelete && (
        <div className="absolute inset-0 z-10 rounded-xl bg-white/60" />
      )}
    </div>
  )
}

export function ServicioForm({
  defaultValues,
  onSubmit,
  onDraftChange,
  clearDraftSignal,
  refaccionesContent,
  cierreContent,
  canShowCierre = false,
  cierre,
  isLoading,
  servicio,
  formId,
  showSubmitButton = true,
  requireTecnicoParaEnRuta = false,
  requireFechaServicioParaCompletar = false,
}: Props) {
  const [openClienteModal, setOpenClienteModal] = useState(false)
  const [openMaquinaModal, setOpenMaquinaModal] = useState(false)
  const [openCierreDialog, setOpenCierreDialog] = useState(false)
  const [previewEvidencia, setPreviewEvidencia] = useState<EvidenciaPreview | null>(null)
  const [evidenciaAEliminar, setEvidenciaAEliminar] = useState<Evidencia | null>(null)
  const { toast } = useToast()
  const evidenciaFotosInputRef = useRef<HTMLInputElement>(null)
  const evidenciaOrdenInputRef = useRef<HTMLInputElement>(null)
  const ultimoDefaultTipoRef = useRef<TipoServicioDefaults | null>(null)
  const todayIso = formatLocalIsoDate(new Date())

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    setValue,
    reset,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<CrearServicioInput>({
    resolver: zodResolver(crearServicioSchema),
    defaultValues: {
      tipo_servicio: 'MTTO CORRECTIVO RUTA',
      clase_orden: 'ZSM1',
      costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
      fecha_solicitud: new Date().toISOString().split('T')[0],
      ...defaultValues,
      ...(servicio
        ? {
            tipo_servicio: servicio.tipo_servicio,
            clase_orden: servicio.clase_orden ?? undefined,
            cliente_id: servicio.cliente_id ?? undefined,
            maquina_id: servicio.maquina_id ?? undefined,
            tecnico_id: servicio.tecnico_id ?? undefined,
            descripcion: servicio.descripcion ?? undefined,
            fecha_solicitud: servicio.fecha_solicitud ?? undefined,
            fecha_servicio: servicio.fecha_servicio ?? undefined,
            costo_mano_obra: servicio.costo_mano_obra,
            orden: servicio.orden ?? undefined,
            aviso: servicio.aviso ?? undefined,
          }
        : {}),
    },
  })

  const clienteId = watch('cliente_id')
  const maquinaId = watch('maquina_id')
  const tipoServicioValue = watch('tipo_servicio') ?? ''
  const claseOrdenValue = watch('clase_orden') ?? null
  const costoManoObra = watch('costo_mano_obra') ?? 0
  const tecnicoSeleccionado = watch('tecnico_id')
  const fechaServicioCapturada = watch('fecha_servicio')
  const isInstalacion = tipoServicioValue.trim().toUpperCase().includes('INSTALACION')

  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: clientes = [] } = useClientesQuery()
  const { data: maquinas = [] } = useMaquinasQuery(clienteId)
  const { data: maquinasCatalogo = [] } = useMaquinasQuery()
  const { data: serviciosRegistrados = [] } = useServiciosQuery()
  const { mutateAsync: crearCliente, isPending: isCreatingCliente } = useCrearClienteMutation()
  const { mutateAsync: crearMaquina, isPending: isCreatingMaquina } = useCrearMaquinaMutation()
  const servicioId = servicio?.id ?? 0
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId, Boolean(servicio?.id))
  const { mutateAsync: subirEvidenciaAsync, isPending: subiendoEvidencia } = useSubirEvidenciaMutation(servicioId)
  const { mutateAsync: eliminarEvidenciaAsync, isPending: eliminandoEvidencia } = useEliminarEvidenciaMutation(servicioId)

  const clienteModalForm = useForm<CrearClienteInput>({
    resolver: zodResolver(crearClienteSchema),
    defaultValues: {
      codigo_cliente: '',
      nombre: '',
      direccion: null,
      municipio: null,
      telefono: null,
      correo_contacto: null,
      activo: true,
    },
  })

  const maquinaModalForm = useForm<CrearMaquinaInput>({
    resolver: zodResolver(crearMaquinaSchema),
    defaultValues: {
      serie: '',
      modelo: 'KM901',
      cliente_id: null,
      fecha_instalacion: null,
      status: 'operando',
      observaciones: null,
      activo: true,
    },
  })

  const selectedCliente = clientes.find((cliente) => cliente.id === clienteId)
  const selectedMaquina = maquinas.find((maquina) => maquina.id === maquinaId)
    ?? maquinasCatalogo.find((maquina) => maquina.id === maquinaId)
  const maquinasDisponibles = isInstalacion ? maquinasCatalogo : maquinas
  const tiposServicioOptions = Array.from(
    new Set(
      [
        ...DEFAULT_TIPOS_SERVICIO,
        ...serviciosRegistrados
          .map((servicio) => servicio.tipo_servicio?.trim())
          .filter((tipo): tipo is string => Boolean(tipo)),
      ],
    ),
  )
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))

  const clasesOrdenOptions = Array.from(
    new Set(
      [
        ...DEFAULT_CLASES_ORDEN,
        ...serviciosRegistrados
          .map((servicio) => (servicio.clase_orden as unknown as string) ?? '')
          .filter((clase): clase is string => clase.trim().length > 0),
      ],
    ),
  )
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))

  const modelosMaquinaOptions = Array.from(
    new Set(maquinasCatalogo.map((maquina) => maquina.modelo).filter(Boolean)),
  )

  const evidenciaOrden = useMemo(
    () =>
      evidencias
        .filter((evidencia) => isOrdenServicioFilename(evidencia.filename))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null,
    [evidencias],
  )

  const evidenciasFotos = useMemo(
    () =>
      evidencias
        .filter((evidencia) => !isOrdenServicioFilename(evidencia.filename))
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [evidencias],
  )

  const fotosFaltantes = Math.max(0, 4 - evidenciasFotos.length)

  // Sincronizar formulario cuando llegan datos actualizados del servidor
  useEffect(() => {
    if (!servicio) return
    reset({
      tipo_servicio: servicio.tipo_servicio,
      clase_orden: servicio.clase_orden ?? undefined,
      cliente_id: servicio.cliente_id ?? undefined,
      maquina_id: servicio.maquina_id ?? undefined,
      tecnico_id: servicio.tecnico_id ?? undefined,
      descripcion: servicio.descripcion ?? undefined,
      fecha_solicitud: servicio.fecha_solicitud ?? undefined,
      fecha_servicio: servicio.fecha_servicio ?? undefined,
      costo_mano_obra: servicio.costo_mano_obra,
      orden: servicio.orden ?? undefined,
      aviso: servicio.aviso ?? undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicio?.updated_at])

  // Reset maquina_id cuando cambia el cliente
  useEffect(() => {
    if (!servicio && !isInstalacion) {
      setValue('maquina_id', undefined as unknown as number)
    }
  }, [clienteId, isInstalacion, setValue, servicio])

  useEffect(() => {
    if (servicio || !tipoServicioValue) return

    const defaults = getTipoServicioDefaults(tipoServicioValue)
    const previousDefaults = ultimoDefaultTipoRef.current
    const claseActual = (getValues('clase_orden') ?? null) as string | null
    const costoActual = getValues('costo_mano_obra') ?? 0

    if (
      (!claseActual || claseActual === previousDefaults?.clase_orden)
      && defaults.clase_orden !== claseActual
    ) {
      setValue('clase_orden', defaults.clase_orden, {
        shouldValidate: true,
        shouldDirty: true,
      })
    }

    if (
      (costoActual === 0 || costoActual === previousDefaults?.costo_mano_obra)
      && defaults.costo_mano_obra !== costoActual
    ) {
      setValue('costo_mano_obra', defaults.costo_mano_obra, {
        shouldValidate: true,
        shouldDirty: true,
      })
    }

    ultimoDefaultTipoRef.current = defaults
  }, [getValues, servicio, setValue, tipoServicioValue])

  useEffect(() => {
    if (openMaquinaModal && clienteId) {
      maquinaModalForm.setValue('cliente_id', clienteId)
    }
  }, [clienteId, maquinaModalForm, openMaquinaModal])

  useEffect(() => {
    onDraftChange?.(isDirty ? ({} as Partial<CrearServicioInput>) : null)
  }, [isDirty, onDraftChange])

  useEffect(() => {
    if (clearDraftSignal === undefined) return
    reset(getValues())
  }, [clearDraftSignal, getValues, reset])

  useEffect(() => {
    if (tecnicoSeleccionado) {
      clearErrors('tecnico_id')
    }
  }, [tecnicoSeleccionado, clearErrors])

  useEffect(() => {
    if (fechaServicioCapturada) {
      clearErrors('fecha_servicio')
    }
  }, [fechaServicioCapturada, clearErrors])

  const handleFormSubmit = handleSubmit((data) => {
    let hasManualValidationError = false

    if (requireTecnicoParaEnRuta && !data.tecnico_id) {
      setError('tecnico_id', {
        type: 'manual',
        message: 'Para poner el servicio en ruta, asigna un técnico.',
      })
      hasManualValidationError = true
    }

    if (requireFechaServicioParaCompletar && !data.fecha_servicio) {
      setError('fecha_servicio', {
        type: 'manual',
        message: 'Para marcarlo como completado, captura la fecha de servicio.',
      })
      hasManualValidationError = true
    }

    if (hasManualValidationError) return

    onSubmit(data)
  })

  const handleClienteChange = (id: number | null, cliente: Cliente | null) => {
    setValue('cliente_id', id ?? (undefined as unknown as number), { shouldValidate: true, shouldDirty: true })
    if (!isInstalacion) {
      setValue('maquina_id', undefined as unknown as number, { shouldValidate: true, shouldDirty: true })
    }
    void cliente
  }

  const handleCrearCliente = clienteModalForm.handleSubmit(async (values) => {
    try {
      const created = await crearCliente({
        ...values,
        direccion: values.direccion || null,
        municipio: values.municipio || null,
        telefono: values.telefono || null,
        correo_contacto: values.correo_contacto || null,
      })

      setValue('cliente_id', created.id, { shouldValidate: true, shouldDirty: true })
      setValue('maquina_id', undefined as unknown as number, { shouldValidate: true, shouldDirty: true })
      setOpenClienteModal(false)
      clienteModalForm.reset()
      toast({
        title: 'Cliente creado',
        description: `${created.nombre} fue agregado al catálogo.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el cliente.'
      toast({
        title: 'Error al crear cliente',
        description: message,
        variant: 'destructive',
      })
    }
  })

  const handleCrearMaquina = maquinaModalForm.handleSubmit(async (values) => {
    if (!clienteId) {
      toast({
        title: 'Selecciona cliente primero',
        description: 'Debes seleccionar o crear un cliente antes de registrar la máquina.',
        variant: 'destructive',
      })
      return
    }

    try {
      const created = await crearMaquina({
        ...values,
        cliente_id: clienteId,
        fecha_instalacion: values.fecha_instalacion || null,
        observaciones: values.observaciones || null,
      })

      setValue('maquina_id', created.id, { shouldValidate: true, shouldDirty: true })
      setOpenMaquinaModal(false)
      maquinaModalForm.reset({
        serie: '',
        modelo: 'KM901',
        cliente_id: clienteId,
        fecha_instalacion: null,
        status: 'operando',
        observaciones: null,
        activo: true,
      })
      toast({
        title: 'Máquina creada',
        description: `Serie ${created.serie} registrada para ${selectedCliente?.nombre ?? 'el cliente seleccionado'}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la máquina.'
      toast({
        title: 'Error al crear máquina',
        description: message,
        variant: 'destructive',
      })
    }
  })

  const handleAgregarEvidenciasFotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    try {
      for (const file of files) {
        const taggedFile = buildTaggedFile(file, 'ev-foto')
        await subirEvidenciaAsync(taggedFile)
      }
      toast({
        title: 'Evidencias subidas',
        description: `${files.length} archivo(s) cargado(s) correctamente.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron subir las evidencias.'
      toast({ title: 'Error al subir evidencias', description: message, variant: 'destructive' })
    } finally {
      if (evidenciaFotosInputRef.current) evidenciaFotosInputRef.current.value = ''
    }
  }

  const handleAgregarOrdenServicio = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const taggedFile = buildTaggedFile(file, 'orden-servicio')
      await subirEvidenciaAsync(taggedFile)
      toast({
        title: 'Orden de servicio subida',
        description: 'La evidencia de la hoja de orden se guardó correctamente.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo subir la orden de servicio.'
      toast({ title: 'Error al subir orden', description: message, variant: 'destructive' })
    } finally {
      if (evidenciaOrdenInputRef.current) evidenciaOrdenInputRef.current.value = ''
    }
  }

  const handleConfirmarEliminarEvidencia = async () => {
    if (!evidenciaAEliminar) return

    try {
      await eliminarEvidenciaAsync(evidenciaAEliminar.id)
      toast({
        title: 'Evidencia eliminada',
        description: 'La imagen fue eliminada correctamente.',
      })
      setEvidenciaAEliminar(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la evidencia.'
      toast({
        title: 'Error al eliminar evidencia',
        description: message,
        variant: 'destructive',
      })
    }
  }

  return (
    <form id={formId} onSubmit={handleFormSubmit} className="space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[1.05fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-ran-navy">Información del servicio</h3>
          <p className="mt-1 text-sm text-ran-slate">Complete la información operativa y administrativa</p>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fecha_solicitud">Fecha solicitud</Label>
              <input type="hidden" {...register('fecha_solicitud')} />
              <DatePickerInput
                value={watch('fecha_solicitud')}
                onChange={(value) => {
                  const safeValue = value && value > todayIso ? todayIso : value
                  setValue('fecha_solicitud', safeValue ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }}
                placeholder="Seleccionar fecha solicitud"
                maxDate={todayIso}
              />
              {errors.fecha_solicitud && <p className="text-xs text-destructive">{errors.fecha_solicitud.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo_servicio">Tipo de servicio</Label>
              <CreatableCombobox
                value={tipoServicioValue}
                options={tiposServicioOptions}
                onChange={(value) =>
                  setValue('tipo_servicio', value ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Seleccionar tipo"
                searchPlaceholder="Escribe para buscar o crear tipo de servicio"
              />
              {errors.tipo_servicio && <p className="text-xs text-destructive">{errors.tipo_servicio.message}</p>}
              {!errors.tipo_servicio && (
                <p className="text-xs text-ran-slate">Si no aparece en la lista, escríbelo para guardarlo en el flujo. Se sugiere automáticamente la clase de orden y mano de obra base.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clase_orden">Clase de orden</Label>
              <CreatableCombobox
                value={claseOrdenValue}
                options={clasesOrdenOptions}
                onChange={(value) =>
                  setValue('clase_orden', value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Seleccionar clase"
                searchPlaceholder="Escribe para buscar o crear clase de orden"
                allowClear
                clearLabel="Sin clase"
              />
              <p className="text-xs text-ran-slate">También puedes capturar una clase nueva si aún no está registrada.</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="aviso">No. Aviso</Label>
              <Input
                id="aviso"
                type="number"
                className="h-11 rounded-xl"
                {...register('aviso', {
                  setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
                })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="orden">No. Orden</Label>
              <Input
                id="orden"
                type="number"
                className="h-11 rounded-xl"
                {...register('orden', {
                  setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
                })}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tecnico_id">Técnico asignado</Label>
              <Select
                value={watch('tecnico_id') ?? 'none'}
                onValueChange={(value) => setValue('tecnico_id', value === 'none' ? null : value, { shouldValidate: true, shouldDirty: true })}
              >
                <SelectTrigger
                  id="tecnico_id"
                  className={`h-11 rounded-xl ${errors.tecnico_id ? 'border-destructive' : ''}`}
                >
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar por ahora</SelectItem>
                  {tecnicos.map((tecnico) => (
                    <SelectItem key={tecnico.id} value={tecnico.id}>{tecnico.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.tecnico_id ? (
                <p className="text-xs text-destructive">{errors.tecnico_id.message}</p>
              ) : (
                <p className="text-xs text-ran-slate">Puedes asignarlo después, cuando se confirme la ruta del día.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fecha_servicio">Fecha servicio</Label>
              <input type="hidden" {...register('fecha_servicio')} />
              <DatePickerInput
                value={watch('fecha_servicio')}
                onChange={(value) => {
                  const safeValue = value && value > todayIso ? todayIso : value
                  setValue('fecha_servicio', safeValue, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }}
                placeholder="Seleccionar fecha servicio"
                allowClear
                maxDate={todayIso}
                className={errors.fecha_servicio ? 'rounded-xl border border-destructive p-0.5' : undefined}
              />
              {errors.fecha_servicio && <p className="text-xs text-destructive">{errors.fecha_servicio.message}</p>}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="descripcion">Descripción</Label>
            <textarea
              id="descripcion"
              {...register('descripcion')}
              rows={4}
              placeholder="Describe el trabajo a realizar..."
              className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {errors.descripcion && <p className="text-xs text-destructive">{errors.descripcion.message}</p>}
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="costo_mano_obra">Costo del servicio</Label>
            <Input
              id="costo_mano_obra"
              type="number"
              step="0.01"
              className="h-11 rounded-xl"
              {...register('costo_mano_obra', {
                setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
              })}
            />
          </div>
        </section>

        <div className="space-y-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-ran-navy">Cliente y máquina</h3>
              <p className="mt-1 text-sm text-ran-slate">Se autollena al seleccionar cliente y máquina</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Cliente</Label>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setOpenClienteModal(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Crear cliente
                </Button>
              </div>
              <ClienteCombobox value={clienteId ?? null} onChange={handleClienteChange} />
              {errors.cliente_id && <p className="text-xs text-destructive">{errors.cliente_id.message}</p>}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="codigo_cliente">Código de cliente</Label>
                <Input id="codigo_cliente" readOnly value={selectedCliente?.codigo_cliente ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nombre_cliente">Establecimiento</Label>
                <Input id="nombre_cliente" readOnly value={selectedCliente?.nombre ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="direccion_cliente">Dirección</Label>
                <Input id="direccion_cliente" readOnly value={selectedCliente?.direccion ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telefono_cliente">Teléfono</Label>
                <Input id="telefono_cliente" readOnly value={selectedCliente?.telefono ?? ''} placeholder="Sin teléfono registrado" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-1.5">
                <div className="flex min-h-8 items-center justify-between">
                  <Label htmlFor="maquina_id">Modelo máquina</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => setOpenMaquinaModal(true)}
                    disabled={!clienteId}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Registrar máquina
                  </Button>
                </div>
                <Select
                  value={watch('maquina_id') ? String(watch('maquina_id')) : undefined}
                  onValueChange={(value) => setValue('maquina_id', Number(value), { shouldValidate: true, shouldDirty: true })}
                  disabled={!isInstalacion && !clienteId}
                >
                  <SelectTrigger id="maquina_id" className="h-11 rounded-xl">
                    <SelectValue placeholder={isInstalacion ? 'Seleccionar máquina del catálogo' : clienteId ? 'Seleccionar máquina' : 'Selecciona cliente primero'} />
                  </SelectTrigger>
                  <SelectContent>
                    {maquinasDisponibles.map((maquina) => (
                      <SelectItem key={maquina.id} value={String(maquina.id)}>{maquina.modelo} | {maquina.serie}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isInstalacion && (
                  <p className="text-xs text-ran-slate">Para instalaciones puedes elegir cualquier máquina activa, aunque esté asociada a otro cliente.</p>
                )}
                {!isInstalacion && clienteId && maquinasDisponibles.length === 0 && (
                  <p className="text-xs text-ran-slate">Este cliente no tiene máquinas registradas. Usa el botón "Registrar máquina".</p>
                )}
                {errors.maquina_id && <p className="text-xs text-destructive">{errors.maquina_id.message}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex min-h-8 items-center">
                  <Label htmlFor="serie_maquina">Serie máquina</Label>
                </div>
                <Input id="serie_maquina" readOnly value={selectedMaquina?.serie ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>
          </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm py-5">
            <h4 className="text-base font-bold text-ran-navy">Información de cierre</h4>
            <p className="mt-1 text-xs text-ran-slate">
              Completa el cierre al finalizar el servicio.
            </p>

            {servicio?.status === 'cerrado' || Boolean(cierre) ? (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700">
                Servicio cerrado ✓
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Button
                  type="button"
                  className="h-10 w-full rounded-xl bg-ran-navy text-sm hover:bg-ran-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setOpenCierreDialog(true)}
                  disabled={!canShowCierre || !cierreContent}
                >
                  Abrir formulario de cierre
                </Button>

                <div
                  className={`rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed ${
                    canShowCierre && cierreContent
                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {canShowCierre && cierreContent
                    ? 'Completa el formulario de cierre y da clic en "Cerrar servicio".'
                    : 'Cambia el status a "Completado" para poder cerrar el servicio.'}
                </div>
              </div>
            )}

            {showSubmitButton && (
              <Button type="submit" disabled={isLoading} className="mt-3 h-10 w-full rounded-xl bg-ran-navy text-sm font-semibold hover:bg-ran-navy/90">
                {isLoading ? 'Guardando...' : servicio ? 'Actualizar servicio' : 'Guardar servicio'}
              </Button>
            )}
          </section>
        </div>
      </div>

      <div className="space-y-3">
          <section className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-lg font-bold text-ran-navy">Componentes / Refacciones</h4>
            {refaccionesContent ?? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-[1.4fr_0.45fr_0.55fr_0.55fr] gap-2 border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-wide text-ran-slate">
                  <span>Pieza</span>
                  <span>Cant.</span>
                  <span>P. Unit.</span>
                  <span>Total</span>
                </div>
                <p className="py-5 text-sm text-ran-slate">Las refacciones se agregan al editar el servicio.</p>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="font-semibold text-ran-slate">Total del servicio</span>
                  <span className="text-base font-extrabold text-ran-navy">{formatMXN(costoManoObra)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-bold text-ran-navy">Evidencias fotográficas</h4>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${fotosFaltantes === 0 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {evidenciasFotos.length}/4 mínimo
              </span>
            </div>
            <p className="mt-1 text-sm text-ran-slate">Sube mínimo 4 fotos del servicio y agrega más si es necesario.</p>

            {!servicio?.id ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
                Guarda primero el servicio para habilitar la carga de evidencias.
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {loadingEvidencias ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <div key={`skeleton-${index}`} className="h-36 animate-pulse rounded-xl bg-slate-100" />
                    ))
                  ) : (
                    <>
                      {evidenciasFotos.map((evidencia) => (
                        <EvidenciaThumbnail
                          key={evidencia.id}
                          evidencia={evidencia}
                          disableDelete={eliminandoEvidencia}
                          onRequestDelete={setEvidenciaAEliminar}
                          onPreview={setPreviewEvidencia}
                        />
                      ))}
                      {Array.from({ length: Math.max(0, 4 - evidenciasFotos.length) }).map((_, index) => (
                        <div key={`placeholder-${index}`} className="flex h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-ran-slate">
                          <Camera className="mb-2 h-5 w-5 text-slate-400" />
                          Evidencia pendiente
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {fotosFaltantes > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Faltan {fotosFaltantes} evidencia(s) para cumplir el mínimo de 4.
                  </div>
                )}

                <div className="mt-4">
                  <input
                    ref={evidenciaFotosInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={handleAgregarEvidenciasFotos}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => evidenciaFotosInputRef.current?.click()}
                    disabled={subiendoEvidencia}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {subiendoEvidencia ? 'Subiendo...' : 'Agregar evidencias'}
                  </Button>
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-lg font-bold text-ran-navy">Orden de servicio (hoja)</h4>
            <p className="mt-1 text-sm text-ran-slate">Sube la evidencia separada de la hoja de orden entregada en sitio.</p>

            {!servicio?.id ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
                Guarda primero el servicio para habilitar la carga de la hoja de orden.
              </div>
            ) : (
              <>
                <div className="mt-4">
                  {evidenciaOrden ? (
                    <div className="max-w-[220px]">
                      <EvidenciaThumbnail
                        evidencia={evidenciaOrden}
                        disableDelete={eliminandoEvidencia}
                        onRequestDelete={setEvidenciaAEliminar}
                        onPreview={setPreviewEvidencia}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                      <p className="text-sm text-ran-slate">Aún no se ha cargado la hoja de orden.</p>
                      <FileText className="h-5 w-5 text-slate-400" />
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <input
                    ref={evidenciaOrdenInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleAgregarOrdenServicio}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => evidenciaOrdenInputRef.current?.click()}
                    disabled={subiendoEvidencia}
                  >
                    <UploadCloud className="h-4 w-4" />
                    {subiendoEvidencia ? 'Subiendo...' : evidenciaOrden ? 'Reemplazar hoja de orden' : 'Subir hoja de orden'}
                  </Button>
                </div>
              </>
            )}
          </section>
      </div>

      <Dialog open={openCierreDialog} onOpenChange={setOpenCierreDialog}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Formulario de cierre</DialogTitle>
            <DialogDescription>
              Completa los datos para cerrar el servicio. Al guardar, el status cambiará a cerrado.
            </DialogDescription>
          </DialogHeader>
          {cierreContent}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewEvidencia)}
        onOpenChange={(open) => {
          if (!open) setPreviewEvidencia(null)
        }}
      >
        <DialogContent className="max-w-5xl p-3 sm:p-5">
          <DialogHeader>
            <DialogTitle>Vista previa de evidencia</DialogTitle>
            <DialogDescription className="truncate">{previewEvidencia?.filename}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-slate-100 p-2">
            {previewEvidencia && (
              <img
                src={previewEvidencia.downloadUrl}
                alt={previewEvidencia.filename}
                className="max-h-[75vh] w-full rounded-lg object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(evidenciaAEliminar)}
        onOpenChange={(open) => {
          if (!open) setEvidenciaAEliminar(null)
        }}
        title={
          evidenciaAEliminar && isOrdenServicioFilename(evidenciaAEliminar.filename)
            ? '¿Eliminar orden de servicio?'
            : '¿Eliminar evidencia?'
        }
        description={
          evidenciaAEliminar
            ? isOrdenServicioFilename(evidenciaAEliminar.filename)
              ? `Se eliminará la hoja de orden \"${getDisplayFilename(evidenciaAEliminar.filename)}\". Esta acción no se puede deshacer.`
              : `Se eliminará la imagen \"${getDisplayFilename(evidenciaAEliminar.filename)}\". Esta acción no se puede deshacer.`
            : 'Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          void handleConfirmarEliminarEvidencia()
        }}
        isLoading={eliminandoEvidencia}
      />

      <Dialog open={openClienteModal} onOpenChange={setOpenClienteModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Crear cliente</DialogTitle>
            <DialogDescription>Registra un cliente sin salir de la orden de servicio.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrearCliente} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nuevo_codigo_cliente">Código de cliente</Label>
                <Input id="nuevo_codigo_cliente" {...clienteModalForm.register('codigo_cliente')} placeholder="Ej. 300831815" />
                {clienteModalForm.formState.errors.codigo_cliente && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.codigo_cliente.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nuevo_nombre_cliente">Nombre</Label>
                <Input id="nuevo_nombre_cliente" {...clienteModalForm.register('nombre')} placeholder="Tkt Six Centenario" />
                {clienteModalForm.formState.errors.nombre && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.nombre.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nuevo_direccion_cliente">Dirección</Label>
              <Input id="nuevo_direccion_cliente" {...clienteModalForm.register('direccion')} placeholder="Dirección del establecimiento" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_municipio_cliente">Municipio</Label>
                <Input id="nuevo_municipio_cliente" {...clienteModalForm.register('municipio')} placeholder="Monterrey" />
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_telefono_cliente">Teléfono</Label>
                <Input id="nuevo_telefono_cliente" {...clienteModalForm.register('telefono')} placeholder="81..." />
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_correo_cliente">Correo</Label>
                <Input id="nuevo_correo_cliente" type="email" {...clienteModalForm.register('correo_contacto')} placeholder="contacto@cliente.com" />
                {clienteModalForm.formState.errors.correo_contacto && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.correo_contacto.message}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenClienteModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-ran-navy hover:bg-ran-navy/90" disabled={isCreatingCliente}>
                {isCreatingCliente ? 'Guardando...' : 'Guardar cliente'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={openMaquinaModal} onOpenChange={setOpenMaquinaModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar máquina</DialogTitle>
            <DialogDescription>La máquina se registrará para el cliente seleccionado.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrearMaquina} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nueva_serie_maquina">Serie</Label>
                <Input id="nueva_serie_maquina" {...maquinaModalForm.register('serie')} placeholder="Serie de la máquina" />
                {maquinaModalForm.formState.errors.serie && (
                  <p className="text-xs text-destructive">{maquinaModalForm.formState.errors.serie.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nuevo_modelo_maquina">Modelo</Label>
                <Input
                  id="nuevo_modelo_maquina"
                  list="modelos-maquina-list"
                  value={maquinaModalForm.watch('modelo') ?? ''}
                  onChange={(event) => maquinaModalForm.setValue('modelo', event.target.value, { shouldValidate: true })}
                  placeholder="Seleccionar o escribir modelo"
                />
                <datalist id="modelos-maquina-list">
                  {modelosMaquinaOptions.map((modelo) => (
                    <option key={modelo} value={modelo} />
                  ))}
                </datalist>
                {maquinaModalForm.formState.errors.modelo && (
                  <p className="text-xs text-destructive">{maquinaModalForm.formState.errors.modelo.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nueva_fecha_instalacion">Fecha de instalación</Label>
                <input type="hidden" {...maquinaModalForm.register('fecha_instalacion')} />
                <DatePickerInput
                  value={maquinaModalForm.watch('fecha_instalacion')}
                  onChange={(value) =>
                    maquinaModalForm.setValue('fecha_instalacion', value, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Seleccionar fecha de instalación"
                  allowClear
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nuevo_status_maquina">Status</Label>
                <Select
                  value={maquinaModalForm.watch('status')}
                  onValueChange={(value) => maquinaModalForm.setValue('status', value as CrearMaquinaInput['status'], { shouldValidate: true })}
                >
                  <SelectTrigger id="nuevo_status_maquina">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operando">Operando</SelectItem>
                    <SelectItem value="en_taller">En taller</SelectItem>
                    <SelectItem value="baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nueva_observaciones_maquina">Observaciones</Label>
              <Input id="nueva_observaciones_maquina" {...maquinaModalForm.register('observaciones')} placeholder="Opcional" />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ran-slate">
              Cliente actual: {selectedCliente?.nombre ?? 'Sin cliente seleccionado'}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenMaquinaModal(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-ran-navy hover:bg-ran-navy/90"
                disabled={isCreatingMaquina || !clienteId}
              >
                {isCreatingMaquina ? 'Guardando...' : 'Guardar máquina'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </form>
  )
}
