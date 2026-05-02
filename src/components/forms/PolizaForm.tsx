import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
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
import { crearPolizaSchema, type CrearPolizaInput } from '@/schemas/poliza.schema'
import { useMaquinasQuery, useCrearMaquinaMutation } from '@/hooks/use-maquinas'
import { useClientesQuery, useCrearClienteMutation } from '@/hooks/use-clientes'
import { useToast } from '@/hooks/use-toast'
import { ClienteCombobox } from './ClienteCombobox'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { getSpanishErrorMessage } from '@/lib/error-messages'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  crearClienteSchema,
  crearMaquinaSchema,
  type CrearClienteInput,
  type CrearMaquinaInput,
} from '@/schemas/cliente.schema'
import type { Poliza } from '@/types/domain.types'

interface Props {
  onSubmit: (data: CrearPolizaInput) => void
  isLoading?: boolean
  poliza?: Poliza
  formId?: string
  showSubmitButton?: boolean
}

export function PolizaForm({
  onSubmit,
  isLoading,
  poliza,
  formId,
  showSubmitButton = true,
}: Props) {
  const [openClienteModal, setOpenClienteModal] = useState(false)
  const [openMaquinaModal, setOpenMaquinaModal] = useState(false)
  const { toast } = useToast()

  const { data: clientes = [] } = useClientesQuery()
  const { mutateAsync: crearCliente, isPending: isCreatingCliente } = useCrearClienteMutation()
  const { mutateAsync: crearMaquina, isPending: isCreatingMaquina } = useCrearMaquinaMutation()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CrearPolizaInput>({
    resolver: zodResolver(crearPolizaSchema),
    defaultValues: poliza
      ? {
          cliente_id: poliza.cliente_id,
          maquina_id: poliza.maquina_id,
          fecha_inicio: poliza.fecha_inicio,
          observaciones: poliza.observaciones ?? undefined,
          activa: poliza.activa,
        }
      : {
          activa: true,
          fecha_inicio: new Date().toISOString().split('T')[0],
        },
  })

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

  const clienteId = watch('cliente_id')
  const maquinaId = watch('maquina_id')

  const { data: maquinas = [] } = useMaquinasQuery(clienteId)
  const { data: maquinasCatalogo = [] } = useMaquinasQuery()

  const selectedCliente = clientes.find((cliente) => cliente.id === clienteId)
  const selectedMaquina = maquinas.find((maquina) => maquina.id === maquinaId)
  const modelosMaquinaOptions = Array.from(
    new Set(maquinasCatalogo.map((maquina) => maquina.modelo).filter(Boolean)),
  )

  useEffect(() => {
    if (!poliza) {
      setValue('maquina_id', undefined as unknown as number)
    }
  }, [clienteId, setValue, poliza])

  useEffect(() => {
    if (openMaquinaModal && clienteId) {
      maquinaModalForm.setValue('cliente_id', clienteId)
    }
  }, [clienteId, maquinaModalForm, openMaquinaModal])

  const handleClienteChange = (id: number | null) => {
    setValue('cliente_id', id ?? (undefined as unknown as number), {
      shouldValidate: true,
      shouldDirty: true,
    })
    setValue('maquina_id', undefined as unknown as number, {
      shouldValidate: true,
      shouldDirty: true,
    })
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

      setValue('cliente_id', created.id, {
        shouldValidate: true,
        shouldDirty: true,
      })
      setValue('maquina_id', undefined as unknown as number, {
        shouldValidate: true,
        shouldDirty: true,
      })

      setOpenClienteModal(false)
      clienteModalForm.reset()

      toast({
        title: 'Cliente creado',
        description: `${created.nombre} fue agregado al catálogo.`,
      })
    } catch (error) {
      const message = getSpanishErrorMessage(error, 'No se pudo crear el cliente.')
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

      setValue('maquina_id', created.id, {
        shouldValidate: true,
        shouldDirty: true,
      })

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
      const message = getSpanishErrorMessage(error, 'No se pudo crear la máquina.')
      toast({
        title: 'Error al crear máquina',
        description: message,
        variant: 'destructive',
      })
    }
  })

  return (
    <>
      <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-ran-navy">Cliente y máquina</h3>
          <p className="mt-1 text-sm text-ran-slate">La información del establecimiento se autollena al seleccionar un cliente.</p>

          <div className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Cliente *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => setOpenClienteModal(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Crear cliente
                </Button>
              </div>
              <ClienteCombobox value={clienteId ?? null} onChange={(id) => handleClienteChange(id)} />
              {errors.cliente_id && (
                <p className="text-xs text-destructive">{errors.cliente_id.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="codigo_cliente">Código cliente</Label>
                <Input
                  id="codigo_cliente"
                  readOnly
                  value={selectedCliente?.codigo_cliente ?? ''}
                  placeholder="Se llena automáticamente"
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nombre_cliente">Establecimiento</Label>
                <Input
                  id="nombre_cliente"
                  readOnly
                  value={selectedCliente?.nombre ?? ''}
                  placeholder="Se llena automáticamente"
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="direccion_cliente">Dirección</Label>
                <Input
                  id="direccion_cliente"
                  readOnly
                  value={selectedCliente?.direccion ?? ''}
                  placeholder="Se llena automáticamente"
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telefono_cliente">Teléfono</Label>
                <Input
                  id="telefono_cliente"
                  readOnly
                  value={selectedCliente?.telefono ?? ''}
                  placeholder="Sin teléfono registrado"
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-1.5">
                <div className="flex min-h-8 items-center justify-between">
                  <Label htmlFor="maquina_id">Máquina *</Label>
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
                  value={maquinaId ? String(maquinaId) : undefined}
                  onValueChange={(value) =>
                    setValue('maquina_id', Number(value), {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  disabled={!clienteId}
                >
                  <SelectTrigger id="maquina_id" className="h-11 rounded-xl">
                    <SelectValue placeholder={clienteId ? 'Seleccionar máquina' : 'Selecciona cliente primero'} />
                  </SelectTrigger>
                  <SelectContent>
                    {maquinas.map((maquina) => (
                      <SelectItem key={maquina.id} value={String(maquina.id)}>
                        {maquina.modelo} | {maquina.serie}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clienteId && maquinas.length === 0 && (
                  <p className="text-xs text-ran-slate">Este cliente no tiene máquinas registradas. Usa el botón "Registrar máquina".</p>
                )}
                {errors.maquina_id && (
                  <p className="text-xs text-destructive">{errors.maquina_id.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="serie_maquina">Serie máquina</Label>
                <Input
                  id="serie_maquina"
                  readOnly
                  value={selectedMaquina?.serie ?? ''}
                  placeholder="Se llena automáticamente"
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-ran-navy">Datos de póliza</h3>
          <p className="mt-1 text-sm text-ran-slate">Define la fecha de inicio y notas operativas para este establecimiento.</p>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fecha_inicio">Fecha de inicio *</Label>
              <input type="hidden" {...register('fecha_inicio')} />
              <DatePickerInput
                value={watch('fecha_inicio')}
                onChange={(value) =>
                  setValue('fecha_inicio', value ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Seleccionar fecha de inicio"
              />
              {errors.fecha_inicio && (
                <p className="text-xs text-destructive">{errors.fecha_inicio.message}</p>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="observaciones">Observaciones</Label>
            <textarea
              id="observaciones"
              {...register('observaciones')}
              rows={4}
              className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Notas adicionales sobre la póliza..."
            />
          </div>

          {showSubmitButton && (
            <Button type="submit" disabled={isLoading} className="mt-4 w-full bg-ran-navy hover:bg-ran-navy/90">
              {isLoading ? 'Guardando...' : poliza ? 'Actualizar póliza' : 'Crear póliza'}
            </Button>
          )}
        </section>
      </form>

      <Dialog open={openClienteModal} onOpenChange={setOpenClienteModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Crear cliente</DialogTitle>
            <DialogDescription>Registra un cliente sin salir del alta de póliza.</DialogDescription>
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
    </>
  )
}
