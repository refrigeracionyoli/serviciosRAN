import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock3, Factory, History, Plus, Search, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
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
import { useToast } from '@/hooks/use-toast'
import { useClientesQuery } from '@/hooks/use-clientes'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import {
  useMaquinaTallerMovimientosQuery,
  useMaquinasEnTallerQuery,
  useRegistrarEntradaTallerMutation,
} from '@/hooks/use-maquinas-taller'
import { cn, formatDate } from '@/lib/utils'
import type { MaquinaEnTaller, MaquinaTallerMovimiento } from '@/types/domain.types'

type FiltroLista = 'abiertas' | 'cerradas' | 'todas'
type MotivoIngreso = 'instalacion' | 'manual'

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

function getRegistroEstadoLabel(registro: MaquinaEnTaller): string {
  return registro.fecha_salida ? 'Cerrado' : 'En taller'
}

function getRegistroEstadoClass(registro: MaquinaEnTaller): string {
  return registro.fecha_salida
    ? 'border-slate-200 bg-slate-100 text-slate-700'
    : 'border-blue-200 bg-blue-100 text-blue-800'
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

export function MaquinasTallerPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const todayIso = formatLocalIsoDate(new Date())

  const [filtroLista, setFiltroLista] = useState<FiltroLista>('todas')
  const [buscarLista, setBuscarLista] = useState('')
  const [selectedRegistroId, setSelectedRegistroId] = useState<number | null>(null)

  const [openRegistroDialog, setOpenRegistroDialog] = useState(false)
  const [registroMotivo, setRegistroMotivo] = useState<MotivoIngreso>('instalacion')
  const [registroMaquinaId, setRegistroMaquinaId] = useState('none')
  const [registroClienteId, setRegistroClienteId] = useState('none')
  const [registroFecha, setRegistroFecha] = useState(todayIso)
  const [registroOrden, setRegistroOrden] = useState('')
  const [registroDiagnostico, setRegistroDiagnostico] = useState('')

  const { data: registros = [], isLoading } = useMaquinasEnTallerQuery()
  const { data: registrosAbiertos = [] } = useMaquinasEnTallerQuery({ soloAbiertas: true })
  const { data: maquinas = [], isLoading: loadingMaquinas } = useMaquinasQuery()
  const { data: clientes = [] } = useClientesQuery()

  const { mutateAsync: registrarEntradaAsync, isPending: registrandoMaquina } = useRegistrarEntradaTallerMutation()

  useEffect(() => {
    if (!registros.length) {
      setSelectedRegistroId(null)
      return
    }

    if (!selectedRegistroId || !registros.some((registro) => registro.id === selectedRegistroId)) {
      setSelectedRegistroId(registros[0].id)
    }
  }, [registros, selectedRegistroId])

  const registrosCerrados = registros.length - registrosAbiertos.length
  const terminoBusqueda = buscarLista.trim().toLowerCase()

  const registrosFiltrados = useMemo(() => {
    return registros.filter((registro) => {
      const isAbierto = !registro.fecha_salida

      if (filtroLista === 'abiertas' && !isAbierto) return false
      if (filtroLista === 'cerradas' && isAbierto) return false

      if (!terminoBusqueda) return true

      return (
        includesNormalized(registro.maquina?.serie, terminoBusqueda)
        || includesNormalized(registro.maquina?.modelo, terminoBusqueda)
        || includesNormalized(registro.cliente?.nombre ?? registro.maquina?.cliente?.nombre, terminoBusqueda)
        || includesNormalized(registro.diagnostico, terminoBusqueda)
        || includesNormalized(registro.orden ? String(registro.orden) : null, terminoBusqueda)
      )
    })
  }, [filtroLista, registros, terminoBusqueda])

  const registroSeleccionado = useMemo(
    () => registros.find((registro) => registro.id === selectedRegistroId) ?? null,
    [registros, selectedRegistroId],
  )

  const maquinasConRegistroAbierto = useMemo(
    () => new Set(registrosAbiertos.map((registro) => registro.maquina_id)),
    [registrosAbiertos],
  )

  const maquinasDisponibles = useMemo(
    () => maquinas.filter((maquina) => !maquinasConRegistroAbierto.has(maquina.id)),
    [maquinas, maquinasConRegistroAbierto],
  )

  const maquinaHistorialId = registroSeleccionado?.maquina_id
  const { data: movimientosMaquina = [], isLoading: loadingMovimientos } = useMaquinaTallerMovimientosQuery(maquinaHistorialId)

  const resetRegistroForm = () => {
    setRegistroMotivo('instalacion')
    setRegistroMaquinaId('none')
    setRegistroClienteId('none')
    setRegistroFecha(todayIso)
    setRegistroOrden('')
    setRegistroDiagnostico('')
  }

  const handleAbrirRegistroDialog = () => {
    resetRegistroForm()
    setOpenRegistroDialog(true)
  }

  const handleRegistrarMaquina = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      const maquinaId = parseSelectNumber(registroMaquinaId)
      if (!maquinaId) {
        throw new Error('Selecciona una maquina para registrarla en taller.')
      }

      if (!registroFecha) {
        throw new Error('Captura la fecha de ingreso.')
      }

      const ordenText = registroOrden.trim()
      const ordenNumero = ordenText ? Number(ordenText) : undefined

      if (ordenText && (!Number.isFinite(ordenNumero) || ordenNumero <= 0)) {
        throw new Error('El numero de orden debe ser un entero positivo.')
      }

      const created = await registrarEntradaAsync({
        maquina_id: maquinaId,
        cliente_id: parseSelectNumber(registroClienteId) ?? null,
        fecha_entrada: registroFecha,
        orden: ordenNumero,
        diagnostico: registroDiagnostico.trim() || null,
        motivo: registroMotivo,
      })

      setSelectedRegistroId(created.id)
      setFiltroLista('todas')
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

  return (
    <>
      <div>
        <PageHeader
          title="Maquinas en taller"
          description="Vista simplificada: seguimiento de lista e historial. Los movimientos de servicios se sincronizan automaticamente."
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
          <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
            <p className="text-sm font-semibold text-ran-navy">Automatizacion activa</p>
            <p className="mt-1 text-sm text-ran-slate">
              Los ingresos por retiro y las salidas por instalacion se registran automaticamente desde Servicios.
              Usa <span className="font-semibold text-ran-navy">Registrar maquina</span> para ingresos manuales adicionales.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ran-navy">Lista de taller</h3>
                <Badge variant="outline" className="border-blue-200 bg-blue-100 text-blue-800">
                  {registrosAbiertos.length} abiertas
                </Badge>
              </div>

              <div className="mt-3 space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                  <Input
                    value={buscarLista}
                    onChange={(event) => setBuscarLista(event.target.value)}
                    placeholder="Buscar por serie, cliente u orden"
                    className="h-10 rounded-xl border-slate-200 pl-10"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg text-xs font-semibold transition-colors',
                      filtroLista === 'abiertas' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('abiertas')}
                  >
                    Abiertas
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg text-xs font-semibold transition-colors',
                      filtroLista === 'cerradas' ? 'bg-white text-ran-navy shadow-sm' : 'text-ran-slate hover:text-ran-navy',
                    )}
                    onClick={() => setFiltroLista('cerradas')}
                  >
                    Cerradas
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-8 rounded-lg text-xs font-semibold transition-colors',
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
                  <div className="flex h-24 items-center justify-center">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : registrosFiltrados.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ran-slate">
                    No hay registros para este filtro.
                  </p>
                ) : (
                  registrosFiltrados.map((registro) => {
                    const selected = registro.id === selectedRegistroId

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
                          <Badge variant="outline" className={getRegistroEstadoClass(registro)}>
                            {getRegistroEstadoLabel(registro)}
                          </Badge>
                        </div>

                        <p className="mt-2 text-xs text-ran-slate">
                          Entrada: {formatDate(registro.fecha_entrada)} · OS: {registro.orden ? `#${registro.orden}` : 'Sin OS'}
                        </p>
                      </button>
                    )
                  })
                )}
              </div>
            </aside>

            <section className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-ran-slate">En taller</p>
                  <p className="mt-1 text-3xl font-extrabold text-ran-navy">{registrosAbiertos.length}</p>
                  <p className="text-xs text-ran-slate">Registros abiertos</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-ran-slate">Historial</p>
                  <p className="mt-1 text-3xl font-extrabold text-ran-navy">{registros.length}</p>
                  <p className="text-xs text-ran-slate">{registrosCerrados} cerrados</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {!registroSeleccionado ? (
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
                        <Badge variant="outline" className={getRegistroEstadoClass(registroSeleccionado)}>
                          {getRegistroEstadoLabel(registroSeleccionado)}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => navigate(`/catalogos/maquinas/${registroSeleccionado.maquina_id}/historial`)}
                        >
                          <History className="mr-1 h-3.5 w-3.5" />
                          Ver historial completo
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-ran-slate">Registro</p>
                        <p className="mt-1 text-sm font-semibold text-ran-navy">#{registroSeleccionado.id}</p>
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
                  <div className="flex h-28 items-center justify-center">
                    <LoadingSpinner size="lg" />
                  </div>
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
              Usa este formulario solo para ingresos manuales que no llegan automaticamente desde un servicio RETIRO.
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
                    <SelectItem value="manual">Ingreso manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="registro-fecha">Fecha de ingreso</Label>
                <Input
                  id="registro-fecha"
                  type="date"
                  value={registroFecha}
                  max={todayIso}
                  onChange={(event) => setRegistroFecha(event.target.value)}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Maquina</Label>
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
                <p className="text-xs text-ran-slate">Cargando maquinas...</p>
              ) : maquinasDisponibles.length === 0 ? (
                <p className="text-xs text-ran-slate">No hay maquinas disponibles para un nuevo ingreso manual.</p>
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
                disabled={registrandoMaquina || maquinasDisponibles.length === 0}
              >
                {registrandoMaquina ? 'Registrando...' : 'Registrar maquina'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
