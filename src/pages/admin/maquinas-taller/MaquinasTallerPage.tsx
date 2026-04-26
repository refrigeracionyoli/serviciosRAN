import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock3, Factory, History, Plus, Search, Wrench } from 'lucide-react'
import {
  AdminCardListSkeleton,
  AdminStatsGridSkeleton,
} from '@/components/shared/AdminSkeletons'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useClientesQuery } from '@/hooks/use-clientes'
import { useCrearMaquinaMutation, useMaquinasQuery } from '@/hooks/use-maquinas'
import {
  type ServicioTallerOption,
  useMaquinaTallerMovimientosQuery,
  useMaquinasEnTallerQuery,
  useRegistrarEntradaTallerMutation,
  useRegistrarSalidaTallerMutation,
  useServiciosTallerQuery,
} from '@/hooks/use-maquinas-taller'
import { cn, formatDate } from '@/lib/utils'
import type { MaquinaEnTaller, MaquinaTallerMovimiento } from '@/types/domain.types'

type FiltroLista = 'en_taller' | 'instalacion' | 'urban' | 'cerradas_otras' | 'todas'
type MotivoIngreso = 'instalacion' | 'manual'
type RegistroCategoria = 'en_taller' | 'instalacion' | 'urban' | 'cerradas_otras'

interface SalidaTallerResumen {
  id: number
  maquina_taller_id: number | null
  motivo: string
  destino: string | null
  fecha_movimiento: string
  created_at: string
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseSelectNumber(value: string): number | undefined {
  if (value === 'none') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function includesNormalized(value: string | null | undefined, needle: string): boolean {
  if (!value) return false
  return value.toLowerCase().includes(needle)
}

function normalizeLower(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? ''
}

function getRegistroCategoria(registro: MaquinaEnTaller, salida?: SalidaTallerResumen): RegistroCategoria {
  if (!registro.fecha_salida) return 'en_taller'

  const motivo = normalizeLower(salida?.motivo)
  const destino = normalizeLower(salida?.destino)

  if (motivo.includes('urban') || destino.includes('urban')) return 'urban'
  if (motivo.includes('instal')) return 'instalacion'
  return 'cerradas_otras'
}

function getRegistroCategoriaLabel(categoria: RegistroCategoria): string {
  if (categoria === 'en_taller') return 'En taller'
  if (categoria === 'instalacion') return 'Instalada'
  if (categoria === 'urban') return 'Enviado a Urban'
  return 'Cerrada'
}

function getRegistroCategoriaClass(categoria: RegistroCategoria): string {
  if (categoria === 'en_taller') return 'border-blue-200 bg-blue-100 text-blue-800'
  if (categoria === 'instalacion') return 'border-green-200 bg-green-100 text-green-800'
  if (categoria === 'urban') return 'border-amber-200 bg-amber-100 text-amber-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function formatDestinoSalida(destino: string | null | undefined): string {
  if (!destino) return 'Sin destino'
  const normalized = normalizeLower(destino)

  if (normalized.includes('urban')) return 'Urban'
  if (normalized === 'cliente' || normalized.startsWith('cliente:')) return 'Cliente'
  return destino
}

function getAccionBadgeClass(accion: MaquinaTallerMovimiento['accion']): string {
  if (accion === 'entrada') return 'border-blue-200 bg-blue-100 text-blue-800'
  if (accion === 'salida') return 'border-green-200 bg-green-100 text-green-800'
  if (accion === 'reubicacion') return 'border-amber-200 bg-amber-100 text-amber-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function getAccionLabel(accion: MaquinaTallerMovimiento['accion']): string {
  if (accion === 'entrada') return 'Entrada'
  if (accion === 'salida') return 'Salida'
  if (accion === 'reubicacion') return 'Reubicacion'
  return 'Nota'
}

function isActiveInstallationStatus(status: ServicioTallerOption['status']): boolean {
  return status === 'pendiente' || status === 'en_ruta'
}

export function MaquinasTallerPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const todayIso = formatLocalIsoDate(new Date())

  const [filtroLista, setFiltroLista] = useState<FiltroLista>('en_taller')
  const [buscarLista, setBuscarLista] = useState('')
  const [selectedRegistroId, setSelectedRegistroId] = useState<number | null>(null)

  const [openRegistroDialog, setOpenRegistroDialog] = useState(false)
  const [registroMotivo, setRegistroMotivo] = useState<MotivoIngreso>('manual')
  const [registroMaquinaId, setRegistroMaquinaId] = useState('none')
  const [registroClienteId, setRegistroClienteId] = useState('none')
  const [registroFecha, setRegistroFecha] = useState(todayIso)
  const [registroOrden, setRegistroOrden] = useState('')
  const [registroDiagnostico, setRegistroDiagnostico] = useState('')
  const [registroSerie, setRegistroSerie] = useState('')
  const [registroModelo, setRegistroModelo] = useState('')
  const [openUrbanDialog, setOpenUrbanDialog] = useState(false)
  const [urbanFecha, setUrbanFecha] = useState(todayIso)
  const [urbanDetalle, setUrbanDetalle] = useState('')

  const { data: registros = [], isLoading } = useMaquinasEnTallerQuery()
  const { data: registrosAbiertos = [] } = useMaquinasEnTallerQuery({ soloAbiertas: true })
  const { data: instalacionesServicios = [] } = useServiciosTallerQuery('INSTALACION')
  const { data: maquinas = [], isLoading: loadingMaquinas } = useMaquinasQuery()
  const { data: clientes = [] } = useClientesQuery()
  const { data: movimientosTaller = [] } = useMaquinaTallerMovimientosQuery(undefined, { enabled: true })
  const isPageLoading = isLoading || loadingMaquinas

  const { mutateAsync: registrarEntradaAsync, isPending: registrandoMaquina } = useRegistrarEntradaTallerMutation()
  const { mutateAsync: crearMaquinaAsync, isPending: creandoMaquina } = useCrearMaquinaMutation()
  const { mutateAsync: registrarSalidaAsync, isPending: registrandoSalida } = useRegistrarSalidaTallerMutation()

  const salidasRegistros = useMemo<SalidaTallerResumen[]>(() => {
    return movimientosTaller
      .filter((movimiento) => movimiento.accion === 'salida' && movimiento.maquina_taller_id !== null)
      .map((movimiento) => ({
        id: movimiento.id,
        maquina_taller_id: movimiento.maquina_taller_id,
        motivo: movimiento.motivo,
        destino: movimiento.destino,
        fecha_movimiento: movimiento.fecha_movimiento,
        created_at: movimiento.created_at,
      }))
      .sort((left, right) => {
        const leftKey = `${left.fecha_movimiento}|${left.created_at}`
        const rightKey = `${right.fecha_movimiento}|${right.created_at}`
        return rightKey.localeCompare(leftKey)
      })
  }, [movimientosTaller])

  const salidaPorRegistroId = useMemo(() => {
    const result: Record<number, SalidaTallerResumen> = {}
    for (const salida of salidasRegistros) {
      if (!salida.maquina_taller_id) continue
      if (!result[salida.maquina_taller_id]) {
        result[salida.maquina_taller_id] = salida
      }
    }
    return result
  }, [salidasRegistros])

  const instalacionPendientePorMaquinaId = useMemo(() => {
    const result: Record<number, ServicioTallerOption> = {}

    for (const servicio of instalacionesServicios) {
      if (!servicio.maquina_id || !isActiveInstallationStatus(servicio.status)) continue
      if (!result[servicio.maquina_id]) {
        result[servicio.maquina_id] = servicio
      }
    }

    return result
  }, [instalacionesServicios])

  const terminoBusqueda = buscarLista.trim().toLowerCase()

  const conteoCategorias = useMemo(() => {
    return registros.reduce<Record<RegistroCategoria, number>>((acc, registro) => {
      const categoria = getRegistroCategoria(registro, salidaPorRegistroId[registro.id])
      acc[categoria] += 1
      return acc
    }, {
      en_taller: 0,
      instalacion: 0,
      urban: 0,
      cerradas_otras: 0,
    })
  }, [registros, salidaPorRegistroId])

  const registrosFiltrados = useMemo(() => {
    const registrosOrdenados = [...registros].sort((a, b) => {
      const categoriaA = getRegistroCategoria(a, salidaPorRegistroId[a.id])
      const categoriaB = getRegistroCategoria(b, salidaPorRegistroId[b.id])

      if (categoriaA === 'en_taller' && categoriaB !== 'en_taller') return -1
      if (categoriaA !== 'en_taller' && categoriaB === 'en_taller') return 1

      const fechaA = a.fecha_salida ?? a.fecha_entrada ?? a.created_at
      const fechaB = b.fecha_salida ?? b.fecha_entrada ?? b.created_at
      return fechaB.localeCompare(fechaA)
    })

    return registrosOrdenados.filter((registro) => {
      const categoria = getRegistroCategoria(registro, salidaPorRegistroId[registro.id])

      if (filtroLista !== 'todas' && categoria !== filtroLista) return false

      if (!terminoBusqueda) return true

      return (
        includesNormalized(registro.maquina?.serie, terminoBusqueda)
        || includesNormalized(registro.maquina?.modelo, terminoBusqueda)
        || includesNormalized(registro.cliente?.nombre ?? registro.maquina?.cliente?.nombre, terminoBusqueda)
        || includesNormalized(registro.diagnostico, terminoBusqueda)
        || includesNormalized(registro.orden ? String(registro.orden) : null, terminoBusqueda)
        || includesNormalized(getRegistroCategoriaLabel(categoria), terminoBusqueda)
        || includesNormalized(instalacionPendientePorMaquinaId[registro.maquina_id]?.orden?.toString() ?? null, terminoBusqueda)
        || includesNormalized('instalacion pendiente', terminoBusqueda)
      )
    })
  }, [filtroLista, instalacionPendientePorMaquinaId, registros, salidaPorRegistroId, terminoBusqueda])

  useEffect(() => {
    if (!registrosFiltrados.length) {
      setSelectedRegistroId(null)
      return
    }

    if (!selectedRegistroId || !registrosFiltrados.some((registro) => registro.id === selectedRegistroId)) {
      setSelectedRegistroId(registrosFiltrados[0].id)
    }
  }, [registrosFiltrados, selectedRegistroId])

  const registroSeleccionado = useMemo(
    () => registros.find((registro) => registro.id === selectedRegistroId) ?? null,
    [registros, selectedRegistroId],
  )
  const salidaRegistroSeleccionado = registroSeleccionado
    ? salidaPorRegistroId[registroSeleccionado.id]
    : undefined
  const categoriaRegistroSeleccionado = registroSeleccionado
    ? getRegistroCategoria(registroSeleccionado, salidaRegistroSeleccionado)
    : null
  const instalacionPendienteSeleccionada = registroSeleccionado
    ? instalacionPendientePorMaquinaId[registroSeleccionado.maquina_id]
    : undefined

  const maquinasConRegistroAbierto = useMemo(
    () => new Set(registrosAbiertos.map((registro) => registro.maquina_id)),
    [registrosAbiertos],
  )

  const maquinasDisponibles = useMemo(
    () => maquinas.filter((maquina) => !maquinasConRegistroAbierto.has(maquina.id)),
    [maquinas, maquinasConRegistroAbierto],
  )

  const maquinaHistorialId = registroSeleccionado?.maquina_id
  const { data: movimientosMaquina = [], isLoading: loadingMovimientos } = useMaquinaTallerMovimientosQuery(
    maquinaHistorialId,
    { enabled: Boolean(maquinaHistorialId) },
  )
  const isRegistroManual = registroMotivo === 'manual'
  const isSubmittingRegistro = registrandoMaquina || creandoMaquina

  const resetRegistroForm = () => {
    setRegistroMotivo('manual')
    setRegistroMaquinaId('none')
    setRegistroClienteId('none')
    setRegistroFecha(todayIso)
    setRegistroOrden('')
    setRegistroDiagnostico('')
    setRegistroSerie('')
    setRegistroModelo('')
  }

  const resetUrbanForm = () => {
    setUrbanFecha(todayIso)
    setUrbanDetalle('')
  }

  const handleAbrirRegistroDialog = () => {
    resetRegistroForm()
    setOpenRegistroDialog(true)
  }

  const handleAbrirUrbanDialog = () => {
    resetUrbanForm()
    setOpenUrbanDialog(true)
  }

  const handleRegistrarMaquina = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      if (!registroFecha) {
        throw new Error('Captura la fecha de ingreso.')
      }

      const ordenText = registroOrden.trim()
      const ordenNumero = ordenText.length ? Number(ordenText) : null

      if (ordenNumero !== null && (!Number.isFinite(ordenNumero) || ordenNumero <= 0)) {
        throw new Error('El numero de orden debe ser un entero positivo.')
      }

      let maquinaId: number | undefined

      if (isRegistroManual) {
        const serie = registroSerie.trim()
        const modelo = registroModelo.trim()

        if (!serie) {
          throw new Error('Ingresa el número de serie de la máquina.')
        }

        if (!modelo) {
          throw new Error('Ingresa el modelo o nombre de la máquina.')
        }

        const maquinaExistente = maquinas.find((maquina) => normalizeLower(maquina.serie) === normalizeLower(serie))

        if (maquinaExistente) {
          maquinaId = maquinaExistente.id
        } else {
          const maquinaCreada = await crearMaquinaAsync({
            serie,
            modelo,
            cliente_id: null,
            fecha_instalacion: null,
            status: 'operando',
            observaciones: registroDiagnostico.trim() || null,
            activo: true,
          })

          maquinaId = maquinaCreada.id
        }
      } else {
        maquinaId = parseSelectNumber(registroMaquinaId)
        if (!maquinaId) {
          throw new Error('Selecciona una maquina para registrarla en taller.')
        }
      }

      const created = await registrarEntradaAsync({
        maquina_id: maquinaId,
        cliente_id: isRegistroManual ? null : parseSelectNumber(registroClienteId) ?? null,
        fecha_entrada: registroFecha,
        orden: ordenNumero,
        diagnostico: registroDiagnostico.trim() || null,
        motivo: registroMotivo,
      })

      setSelectedRegistroId(created.id)
      setFiltroLista('en_taller')
      setBuscarLista('')
      setOpenRegistroDialog(false)
      resetRegistroForm()

      toast({
        title: 'Maquina registrada',
        description: 'El ingreso manual en taller se guardo correctamente.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar la maquina en taller.'
      toast({
        title: 'Error al registrar maquina',
        description: message,
        variant: 'destructive',
      })
    }
  }

  const handleRegistrarSalidaUrban = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!registroSeleccionado) {
      toast({
        title: 'Sin máquina seleccionada',
        description: 'Selecciona un registro abierto de taller antes de enviarlo a Urban.',
        variant: 'destructive',
      })
      return
    }

    if (categoriaRegistroSeleccionado !== 'en_taller') {
      toast({
        title: 'Registro no disponible',
        description: 'Solo puedes enviar a Urban una máquina que siga abierta en taller.',
        variant: 'destructive',
      })
      return
    }

    if (!urbanFecha) {
      toast({
        title: 'Fecha requerida',
        description: 'Captura la fecha de salida hacia Urban.',
        variant: 'destructive',
      })
      return
    }

    try {
      await registrarSalidaAsync({
        registro_id: registroSeleccionado.id,
        tipo_salida: 'urban',
        fecha_salida: urbanFecha,
        detalle: urbanDetalle.trim() || null,
      })

      setOpenUrbanDialog(false)
      resetUrbanForm()

      toast({
        title: 'Máquina enviada a Urban',
        description: 'El registro de taller se cerró correctamente como salida a Urban.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar la salida a Urban.'
      toast({
        title: 'Error al enviar a Urban',
        description: message,
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      <div>
        <PageHeader
          title="Maquinas en taller"
          description="Seguimiento claro de equipos en taller vs historico cerrado por instalacion, Urban u otros motivos."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                onClick={() => navigate('/catalogos/maquinas')}
              >
                Catalogo de maquinas
              </Button>
              <Button className="h-10 rounded-xl bg-ran-navy px-4 hover:bg-ran-navy/90" onClick={handleAbrirRegistroDialog}>
                <Plus className="mr-1.5 h-4 w-4" />
                Registrar maquina
              </Button>
            </div>
          )}
        />

        <div className="space-y-4 p-5 lg:p-7">
          <p className="text-sm text-ran-slate">
            Esta vista se actualiza automaticamente desde <span className="font-semibold text-ran-navy">Servicios</span> al completar/cerrar
            tipos de retiro, instalacion y envio a Urban. El boton <span className="font-semibold text-ran-navy">Registrar maquina</span> es solo para ingresos manuales.
          </p>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ran-navy">Lista de taller</h3>
                <Badge variant="outline" className="border-blue-200 bg-blue-100 text-blue-800">
                  {conteoCategorias.en_taller} en taller
                </Badge>
              </div>

              <div className="mt-3 space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                  <Input
                    value={buscarLista}
                    onChange={(event) => setBuscarLista(event.target.value)}
                    placeholder="Buscar por serie, cliente, orden o estado"
                    className="h-10 rounded-xl border-slate-200 pl-10"
                  />
                </div>

                <div className="flex flex-wrap gap-2 rounded-xl bg-slate-100 p-2">
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      filtroLista === 'en_taller' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('en_taller')}
                  >
                    En taller
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      filtroLista === 'instalacion' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('instalacion')}
                  >
                    Instaladas
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      filtroLista === 'urban' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('urban')}
                  >
                    Urban
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      filtroLista === 'cerradas_otras' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('cerradas_otras')}
                  >
                    Otras cerradas
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      filtroLista === 'todas' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('todas')}
                  >
                    Todas
                  </button>
                </div>
              </div>

              <div className="mt-4 max-h-[620px] space-y-2 overflow-y-auto pr-1">
                {isLoading ? (
                  <AdminCardListSkeleton count={5} />
                ) : registrosFiltrados.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ran-slate">
                    No hay registros para este filtro.
                  </p>
                ) : (
                  registrosFiltrados.map((registro) => {
                    const selected = registro.id === selectedRegistroId
                    const salidaResumen = salidaPorRegistroId[registro.id]
                    const categoria = getRegistroCategoria(registro, salidaResumen)
                    const instalacionPendiente = categoria === 'en_taller'
                      ? instalacionPendientePorMaquinaId[registro.maquina_id]
                      : undefined

                    return (
                      <button
                        key={registro.id}
                        type="button"
                        className={cn(
                          'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-ran-navy/30 bg-ran-ice/70'
                            : 'border-slate-200 bg-white hover:bg-ran-ice/35',
                        )}
                        onClick={() => setSelectedRegistroId(registro.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ran-navy">
                              {registro.maquina?.serie ?? `Maquina #${registro.maquina_id}`}
                            </p>
                            <p className="truncate text-xs text-ran-slate">
                              {registro.maquina?.modelo ?? 'Sin modelo'} · {registro.cliente?.nombre ?? registro.maquina?.cliente?.nombre ?? 'Sin cliente'}
                            </p>
                          </div>
                          <Badge variant="outline" className={getRegistroCategoriaClass(categoria)}>
                            {getRegistroCategoriaLabel(categoria)}
                          </Badge>
                          {instalacionPendiente && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
                              Instalación pendiente
                            </Badge>
                          )}
                        </div>

                        <p className="mt-2 text-xs text-ran-slate">
                          Entrada: {formatDate(registro.fecha_entrada)} · OS: {registro.orden ? `#${registro.orden}` : 'Sin OS'}
                        </p>
                        {instalacionPendiente && (
                          <p className="mt-1 text-xs text-ran-slate">
                            Instalación pendiente: OS {instalacionPendiente.orden ? `#${instalacionPendiente.orden}` : 'sin orden'} · {instalacionPendiente.status === 'en_ruta' ? 'En ruta' : 'Pendiente'}
                          </p>
                        )}
                        {categoria !== 'en_taller' && (
                          <p className="mt-1 text-xs text-ran-slate">
                            Salida: {formatDate(registro.fecha_salida)} · {getRegistroCategoriaLabel(categoria)}
                            {salidaResumen?.destino ? ` · Destino: ${formatDestinoSalida(salidaResumen.destino)}` : ''}
                          </p>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </aside>

            <section className="space-y-4">
              {isPageLoading ? (
                <AdminStatsGridSkeleton count={4} className="mb-0" />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-ran-slate">En taller ahora</p>
                    <p className="mt-1 text-3xl font-extrabold text-blue-700">{conteoCategorias.en_taller}</p>
                    <p className="text-xs text-ran-slate">Registros abiertos</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-ran-slate">Salidas por instalacion</p>
                    <p className="mt-1 text-3xl font-extrabold text-green-700">{conteoCategorias.instalacion}</p>
                    <p className="text-xs text-ran-slate">Registros cerrados por instalacion</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-ran-slate">Salidas a Urban</p>
                    <p className="mt-1 text-3xl font-extrabold text-amber-700">{conteoCategorias.urban}</p>
                    <p className="text-xs text-ran-slate">Equipos enviados para desecho</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-ran-slate">Otras cerradas</p>
                    <p className="mt-1 text-3xl font-extrabold text-ran-navy">{conteoCategorias.cerradas_otras}</p>
                    <p className="text-xs text-ran-slate">Registros historicos adicionales</p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {isPageLoading ? (
                  <AdminCardListSkeleton count={3} />
                ) : !registroSeleccionado ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-ran-slate">
                    Selecciona una maquina de la lista para ver su detalle.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-ran-navy">
                          {registroSeleccionado.maquina?.modelo ?? 'Equipo'} · {registroSeleccionado.maquina?.serie ?? `#${registroSeleccionado.maquina_id}`}
                        </h3>
                        <p className="mt-1 text-sm text-ran-slate">
                          {registroSeleccionado.cliente?.nombre ?? registroSeleccionado.maquina?.cliente?.nombre ?? 'Sin cliente asignado'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {categoriaRegistroSeleccionado && (
                          <Badge variant="outline" className={getRegistroCategoriaClass(categoriaRegistroSeleccionado)}>
                            {getRegistroCategoriaLabel(categoriaRegistroSeleccionado)}
                          </Badge>
                        )}
                        {instalacionPendienteSeleccionada && categoriaRegistroSeleccionado === 'en_taller' && (
                          <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
                            Instalación pendiente
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => navigate(`/catalogos/maquinas/${registroSeleccionado.maquina_id}/historial`)}
                        >
                          <History className="mr-1 h-3.5 w-3.5" />
                          Ver historial completo
                        </Button>
                        {categoriaRegistroSeleccionado === 'en_taller' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                            onClick={handleAbrirUrbanDialog}
                          >
                            Enviar a Urban
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Fecha de entrada</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">{formatDate(registroSeleccionado.fecha_entrada)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Fecha de salida</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">{formatDate(registroSeleccionado.fecha_salida)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Orden</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">{registroSeleccionado.orden ? `#${registroSeleccionado.orden}` : 'Sin orden'}</p>
                      </div>
                      {(categoriaRegistroSeleccionado === 'en_taller' || instalacionPendienteSeleccionada) && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-ran-slate">Instalación pendiente</p>
                          <p className="mt-1 text-sm font-semibold text-ran-navy">
                            {instalacionPendienteSeleccionada
                              ? `OS ${instalacionPendienteSeleccionada.orden ? `#${instalacionPendienteSeleccionada.orden}` : 'sin orden'}`
                              : 'Sin reserva'}
                          </p>
                          {instalacionPendienteSeleccionada && (
                            <p className="mt-1 text-xs text-ran-slate">
                              {instalacionPendienteSeleccionada.status === 'en_ruta' ? 'Servicio en ruta' : 'Servicio pendiente'}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Registro</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">#{registroSeleccionado.id}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Resultado de salida</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">
                          {categoriaRegistroSeleccionado ? getRegistroCategoriaLabel(categoriaRegistroSeleccionado) : 'Sin dato'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Destino</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">
                          {formatDestinoSalida(salidaRegistroSeleccionado?.destino)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-ran-slate">Diagnostico</p>
                      <p className="mt-1 text-sm text-ran-slate">
                        {registroSeleccionado.diagnostico ?? 'Sin diagnostico registrado.'}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold text-ran-navy">Ultimos movimientos</h3>
                    <p className="text-sm text-ran-slate">
                      {registroSeleccionado
                        ? `Trazabilidad de ${registroSeleccionado.maquina?.serie ?? `maquina #${registroSeleccionado.maquina_id}`}`
                        : 'Selecciona un registro para ver movimientos.'}
                    </p>
                  </div>
                </div>

                {!registroSeleccionado ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                    Sin maquina seleccionada.
                  </div>
                ) : loadingMovimientos ? (
                  <AdminCardListSkeleton count={4} />
                ) : movimientosMaquina.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                    Esta maquina aun no tiene movimientos registrados.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {movimientosMaquina.slice(0, 6).map((movimiento) => (
                      <div key={movimiento.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={getAccionBadgeClass(movimiento.accion)}>
                              {getAccionLabel(movimiento.accion)}
                            </Badge>
                            <span className="text-sm font-semibold text-ran-navy">{movimiento.motivo}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs text-ran-slate">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(movimiento.fecha_movimiento)}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ran-slate">
                          <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1">
                            <Factory className="h-3.5 w-3.5" />
                            {movimiento.origen ?? 'Sin origen'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1">
                            <Wrench className="h-3.5 w-3.5" />
                            {movimiento.destino ?? 'Sin destino'}
                          </span>
                          {movimiento.orden_servicio && (
                            <span className="rounded-md bg-white px-2 py-1">OS #{movimiento.orden_servicio}</span>
                          )}
                        </div>

                        {movimiento.detalle && (
                          <p className="mt-2 text-xs text-ran-slate">{movimiento.detalle}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <Dialog open={openRegistroDialog} onOpenChange={setOpenRegistroDialog}>
        <DialogContent className="max-w-xl rounded-2xl border border-slate-200 p-0">
          <DialogHeader className="border-b border-slate-200 px-6 py-4">
            <DialogTitle className="text-ran-navy">Registrar maquina en taller</DialogTitle>
            <DialogDescription>
              Registra ingresos externos/manuales o prepara una máquina existente para instalación sin depender de un servicio de retiro.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRegistrarMaquina} className="space-y-4 px-6 py-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Motivo de ingreso</Label>
                <Select value={registroMotivo} onValueChange={(value) => setRegistroMotivo(value as MotivoIngreso)}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder="Seleccionar motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instalacion">Preparacion para instalacion</SelectItem>
                    <SelectItem value="manual">Ingreso externo/manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="registro-fecha">Fecha de ingreso</Label>
                <DatePickerInput
                  value={registroFecha}
                  onChange={(value) => setRegistroFecha(value ?? todayIso)}
                  maxDate={todayIso}
                  placeholder="Seleccionar fecha de ingreso"
                />
              </div>
            </div>

            {isRegistroManual ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="registro-modelo">Modelo</Label>
                    <Input
                      id="registro-modelo"
                      value={registroModelo}
                      onChange={(event) => setRegistroModelo(event.target.value)}
                      placeholder="Ej. KM901"
                      className="h-10 rounded-xl"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="registro-serie">Número de serie</Label>
                    <Input
                      id="registro-serie"
                      value={registroSerie}
                      onChange={(event) => setRegistroSerie(event.target.value)}
                      placeholder="Ej. SR-123456"
                      className="h-10 rounded-xl"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-ran-slate">
                  Este modo es para equipos externos. La máquina se registra sin cliente de origen y se crea automáticamente si la serie no existe.
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Máquina</Label>
                  <Select value={registroMaquinaId} onValueChange={setRegistroMaquinaId}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Seleccionar maquina" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Seleccionar maquina</SelectItem>
                      {maquinasDisponibles.map((maquina) => (
                        <SelectItem key={maquina.id} value={String(maquina.id)}>
                          {maquina.modelo} · {maquina.serie}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {loadingMaquinas ? (
                    <Skeleton className="h-4 w-44 rounded-full" />
                  ) : maquinasDisponibles.length === 0 ? (
                    <p className="text-xs text-ran-slate">No hay máquinas disponibles para preparar una instalación manual.</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label>Cliente origen (opcional)</Label>
                  <Select value={registroClienteId} onValueChange={setRegistroClienteId}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Seleccionar cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cliente</SelectItem>
                      {clientes.map((cliente) => (
                        <SelectItem key={cliente.id} value={String(cliente.id)}>
                          {cliente.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="registro-orden">No. de orden (opcional)</Label>
                <Input
                  id="registro-orden"
                  type="number"
                  value={registroOrden}
                  onChange={(event) => setRegistroOrden(event.target.value)}
                  placeholder="Ej. 123456"
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="registro-diagnostico">Detalle inicial (opcional)</Label>
                <Input
                  id="registro-diagnostico"
                  value={registroDiagnostico}
                  onChange={(event) => setRegistroDiagnostico(event.target.value)}
                  placeholder="Notas del ingreso"
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl"
                onClick={() => setOpenRegistroDialog(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-10 rounded-xl bg-ran-navy px-5 hover:bg-ran-navy/90"
                disabled={isSubmittingRegistro || (!isRegistroManual && maquinasDisponibles.length === 0)}
              >
                {isSubmittingRegistro ? 'Registrando...' : 'Registrar maquina'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openUrbanDialog}
        onOpenChange={(nextOpen) => {
          setOpenUrbanDialog(nextOpen)
          if (!nextOpen) {
            resetUrbanForm()
          }
        }}
      >
        <DialogContent className="max-w-xl rounded-2xl border border-slate-200 p-0">
          <DialogHeader className="border-b border-slate-200 px-6 py-4">
            <DialogTitle className="text-ran-navy">Marcar como enviado a Urban</DialogTitle>
            <DialogDescription>
              Cierra el registro abierto de taller y deja el equipo marcado como salida a Urban.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRegistrarSalidaUrban} className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                {registroSeleccionado?.maquina?.modelo ?? 'Equipo'} · {registroSeleccionado?.maquina?.serie ?? 'Sin serie'}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {registroSeleccionado?.cliente?.nombre ?? registroSeleccionado?.maquina?.cliente?.nombre ?? 'Sin cliente asignado'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="urban-fecha">Fecha de salida</Label>
              <DatePickerInput
                value={urbanFecha}
                onChange={(value) => setUrbanFecha(value ?? todayIso)}
                minDate={registroSeleccionado?.fecha_entrada ?? undefined}
                maxDate={todayIso}
                placeholder="Seleccionar fecha de salida"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="urban-detalle">Detalle (opcional)</Label>
              <Input
                id="urban-detalle"
                value={urbanDetalle}
                onChange={(event) => setUrbanDetalle(event.target.value)}
                placeholder="Ej. destrucción, reciclaje o guía de traslado"
                className="h-10 rounded-xl"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl"
                onClick={() => setOpenUrbanDialog(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-10 rounded-xl bg-ran-navy px-5 hover:bg-ran-navy/90"
                disabled={registrandoSalida || categoriaRegistroSeleccionado !== 'en_taller'}
              >
                {registrandoSalida ? 'Guardando...' : 'Confirmar envío a Urban'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
