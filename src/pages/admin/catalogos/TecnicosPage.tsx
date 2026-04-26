import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  MoreVertical,
  Plus,
  Power,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
  AdminTableSkeleton,
} from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { useCambiarPasswordEmpleadoMutation, useEditarTecnicoMutation, useEmpleadosQuery } from '@/hooks/use-tecnicos'
import { getPasswordPolicyError } from '@/lib/password-policy'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { cn } from '@/lib/utils'
import { useFiltrosStore } from '@/stores/filtros.store'
import type { Profile } from '@/types/domain.types'
import { CatalogosSubNav } from './CatalogosSubNav'

const PAGE_SIZE = 10

type EmpleadoStatusFilter = 'all' | 'activos' | 'inactivos'
type PasswordStrengthLevel = 'debil' | 'media' | 'segura'

interface PasswordStrengthResult {
  level: PasswordStrengthLevel
  label: string
  helper: string
  meterValue: 1 | 2 | 3
  meterColorClassName: string
  labelClassName: string
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase()
}

function getInitial(name: string): string {
  const first = name.trim().charAt(0)
  return first ? first.toUpperCase() : '?'
}

function generatePassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%*+-_'
  const all = `${upper}${lower}${digits}${symbols}`

  const pick = (charset: string) => charset[Math.floor(Math.random() * charset.length)]

  const seed = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  while (seed.length < length) {
    seed.push(pick(all))
  }

  for (let index = seed.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[seed[index], seed[randomIndex]] = [seed[randomIndex], seed[index]]
  }

  return seed.join('')
}

function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const value = password.trim()
  if (!value) {
    return {
      level: 'debil',
      label: 'Débil',
      helper: 'Usa 12+ caracteres con mayúsculas, minúsculas, números y símbolos.',
      meterValue: 1,
      meterColorClassName: 'bg-red-500',
      labelClassName: 'text-red-700',
    }
  }

  let score = 0
  if (value.length >= 8) score += 1
  if (value.length >= 12) score += 1
  if (/[a-z]/.test(value)) score += 1
  if (/[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1

  if (/([a-zA-Z0-9])\1{2,}/.test(value)) score -= 1
  if (/(1234|password|qwerty|admin|asdf)/i.test(value)) score -= 2

  if (score >= 5) {
    return {
      level: 'segura',
      label: 'Segura',
      helper: 'Buena contraseña. Recomendación: guárdala en un administrador de contraseñas.',
      meterValue: 3,
      meterColorClassName: 'bg-emerald-500',
      labelClassName: 'text-emerald-700',
    }
  }

  if (score >= 3) {
    return {
      level: 'media',
      label: 'Media',
      helper: 'Mejorable: agrega más longitud y al menos un símbolo para mayor seguridad.',
      meterValue: 2,
      meterColorClassName: 'bg-amber-500',
      labelClassName: 'text-amber-700',
    }
  }

  return {
    level: 'debil',
    label: 'Débil',
    helper: 'Recomendamos una contraseña más fuerte para proteger la cuenta.',
    meterValue: 1,
    meterColorClassName: 'bg-red-500',
    labelClassName: 'text-red-700',
  }
}

export function TecnicosPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<EmpleadoStatusFilter>('all')
  const [page, setPage] = useState(1)
  const [empleadoPasswordTarget, setEmpleadoPasswordTarget] = useState<Profile | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const setFiltros = useFiltrosStore((state) => state.setFiltros)

  const { data: empleados = [], isLoading } = useEmpleadosQuery({ includeInactive: true })
  const { data: servicios = [], isLoading: loadingServicios } = useServiciosQuery()
  const { mutate: editarTecnico, isPending: isUpdatingTecnico } = useEditarTecnicoMutation()
  const { mutate: cambiarPasswordEmpleado, isPending: isUpdatingPassword } = useCambiarPasswordEmpleadoMutation()
  const passwordStrength = evaluatePasswordStrength(newPassword)
  const isPageLoading = isLoading || loadingServicios

  const serviciosMesPorTecnico = useMemo(() => {
    const now = new Date()
    const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEndIso = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    return servicios.reduce<Record<string, number>>((acc, servicio) => {
      if (!servicio.tecnico_id) return acc
      if (servicio.created_at < monthStartIso || servicio.created_at >= monthEndIso) return acc
      acc[servicio.tecnico_id] = (acc[servicio.tecnico_id] ?? 0) + 1
      return acc
    }, {})
  }, [servicios])

  const filteredEmpleados = useMemo(() => {
    return empleados.filter((empleado) => {
      if (status === 'activos' && !empleado.activo) return false
      if (status === 'inactivos' && empleado.activo) return false

      if (!deferredSearch) return true

      return [
        empleado.nombre,
        empleado.correo,
        empleado.telefono,
      ].some((value) => normalizeText(value).includes(deferredSearch))
    })
  }, [deferredSearch, empleados, status])

  const { activos, inactivos } = useMemo(() => {
    const total = empleados.length
    const active = empleados.reduce((count, empleado) => (empleado.activo ? count + 1 : count), 0)
    return {
      activos: active,
      inactivos: total - active,
    }
  }, [empleados])

  const totalServiciosMes = useMemo(
    () => Object.values(serviciosMesPorTecnico).reduce((sum, total) => sum + total, 0),
    [serviciosMesPorTecnico],
  )

  const totalPages = Math.max(1, Math.ceil(filteredEmpleados.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const endIndex = startIndex + PAGE_SIZE
  const pageRows = filteredEmpleados.slice(startIndex, endIndex)

  const handleToggleStatus = (empleado: Profile) => {
    if (empleado.id === user?.id && empleado.role === 'admin' && empleado.activo) {
      toast({
        title: 'Acción no permitida',
        description: 'No puedes desactivar tu propia cuenta de administrador.',
        variant: 'destructive',
      })
      return
    }

    const nextStatus = !empleado.activo
    editarTecnico(
      {
        id: empleado.id,
        data: { activo: nextStatus },
      },
      {
        onSuccess: () => {
          toast({
            title: nextStatus ? 'Empleado activado' : 'Empleado desactivado',
            description: 'El cambio se guardó correctamente.',
          })
        },
        onError: (error) => {
          toast({
            title: 'Error al actualizar empleado',
            description: error instanceof Error ? error.message : 'No se pudo actualizar el empleado.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleViewAssignedServicios = (empleado: Profile) => {
    setFiltros({
      tecnicoId: null,
      search: empleado.nombre,
      status: null,
      fechaDesde: null,
      fechaHasta: null,
      tipoServicio: null,
    })
    navigate('/servicios')
  }

  const openPasswordDialog = (empleado: Profile) => {
    setEmpleadoPasswordTarget(empleado)
    setNewPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const handleGeneratePassword = () => {
    const generated = generatePassword(12)
    setNewPassword(generated)
    setConfirmPassword(generated)
    setShowPassword(true)
    setShowConfirmPassword(true)
  }

  const handleChangeEmpleadoPassword = () => {
    if (!empleadoPasswordTarget) return

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Confirmación inválida',
        description: 'Las contraseñas no coinciden.',
        variant: 'destructive',
      })
      return
    }

    const passwordError = getPasswordPolicyError(newPassword)
    if (passwordError) {
      toast({
        title: 'Contraseña inválida',
        description: passwordError,
        variant: 'destructive',
      })
      return
    }

    cambiarPasswordEmpleado(
      {
        empleadoId: empleadoPasswordTarget.id,
        password: newPassword,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Contraseña actualizada',
            description: `Se actualizó la contraseña de ${empleadoPasswordTarget.nombre}.`,
          })
          setEmpleadoPasswordTarget(null)
          setNewPassword('')
          setConfirmPassword('')
        },
        onError: (error) => {
          toast({
            title: 'Error al actualizar contraseña',
            description: error instanceof Error ? error.message : 'No se pudo cambiar la contraseña del empleado.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Catálogos</h1>
          <p className="mt-1 text-lg text-ran-slate">Administra empleados registrados en el sistema</p>
        </div>

        <div className="flex w-full items-center justify-end lg:w-auto">
          <Button
            onClick={() => navigate('/catalogos/empleados/nuevo')}
            className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90"
          >
            <Plus className="h-4 w-4" />
            Nuevo empleado
          </Button>
        </div>
      </div>

      <CatalogosSubNav />

      {isPageLoading ? (
        <>
          <AdminStatsGridSkeleton count={3} className="mb-3" columnsClassName="md:grid-cols-2 xl:grid-cols-3" />
          <AdminFilterBarSkeleton className="mb-3 lg:grid-cols-[1fr_220px]" items={['', '']} />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Empleados activos</p>
              <p className="mt-1 text-4xl font-extrabold text-green-600">{activos}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Inactivos</p>
              <p className="mt-1 text-4xl font-extrabold text-amber-600">{inactivos}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Servicios técnicos este mes</p>
              <p className="mt-1 text-4xl font-extrabold text-ran-blue">{totalServiciosMes}</p>
            </article>
          </div>

          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative w-full lg:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  placeholder="Buscar empleado..."
                  className="h-11 rounded-xl border-slate-200 pl-10"
                  type="search"
                  name="empleados_search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as EmpleadoStatusFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 lg:w-[220px]">
                  <SelectValue placeholder="Status: Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status: Todos</SelectItem>
                  <SelectItem value="activos">Status: Activos</SelectItem>
                  <SelectItem value="inactivos">Status: Inactivos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <HorizontalScrollArea>
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-5 py-3">Nombre</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Correo</th>
                    <th className="px-3 py-3">Rol</th>
                    <th className="px-3 py-3">Servicios mes</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="w-14 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-ran-slate">
                        No hay empleados para los filtros aplicados.
                      </td>
                    </tr>
                  ) : pageRows.map((empleado) => (
                    <tr key={empleado.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 font-semibold text-ran-navy">
                            {getInitial(empleado.nombre)}
                          </span>
                          <span className="font-semibold text-ran-navy">{empleado.nombre}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-ran-slate">{empleado.telefono ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{empleado.correo}</td>
                      <td className="px-3 py-3.5">
                        {empleado.role === 'admin' ? (
                          <Badge variant="outline" className="border-blue-200 bg-blue-100 text-blue-700">
                            Administrador
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-indigo-200 bg-indigo-100 text-indigo-700">
                            Técnico
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">
                        {empleado.role === 'tecnico' ? (serviciosMesPorTecnico[empleado.id] ?? 0) : '—'}
                      </td>
                      <td className="px-3 py-3.5">
                        {empleado.activo ? (
                          <Badge variant="outline" className="border-green-200 bg-green-100 text-green-800">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700">
                            Inactivo
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
                            {empleado.role === 'tecnico' && (
                              <>
                                <DropdownMenuItem className="cursor-pointer" onClick={() => handleViewAssignedServicios(empleado)}>
                                  <Eye className="h-4 w-4" />
                                  Ver servicios asignados
                                </DropdownMenuItem>

                                <DropdownMenuSeparator />
                              </>
                            )}

                            <DropdownMenuItem className="cursor-pointer" onClick={() => openPasswordDialog(empleado)}>
                              <KeyRound className="h-4 w-4" />
                              Cambiar contraseña
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              className="cursor-pointer"
                              disabled={isUpdatingTecnico}
                              onClick={() => handleToggleStatus(empleado)}
                            >
                              <Power className="h-4 w-4" />
                              {empleado.id === user?.id && empleado.role === 'admin' && empleado.activo
                                ? 'No permitido (tu cuenta)'
                                : empleado.activo
                                  ? 'Desactivar'
                                  : 'Reactivar'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </div>

          <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Mostrando {filteredEmpleados.length ? startIndex + 1 : 0}-{Math.min(endIndex, filteredEmpleados.length)} de {filteredEmpleados.length} empleados
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(1)} disabled={currentPage === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ran-navy">
                {currentPage}
              </span>
              <span className="text-sm">de {totalPages}</span>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={Boolean(empleadoPasswordTarget)} onOpenChange={(open) => !open && setEmpleadoPasswordTarget(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>
              {empleadoPasswordTarget
                ? `Actualiza la contraseña de acceso para ${empleadoPasswordTarget.nombre}.`
                : 'Actualiza la contraseña del empleado.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={empleadoPasswordTarget?.correo ?? ''}
              readOnly
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />

            <div>
              <Label htmlFor="new-password" className="mb-1.5 block">Nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  name="new_password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="••••••••••"
                  className="h-11 rounded-xl pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-1.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="grid w-24 grid-cols-3 gap-1" aria-hidden>
                    {[0, 1, 2].map((index) => (
                      <span
                        key={index}
                        className={cn(
                          'h-1.5 rounded-full transition-colors',
                          index < passwordStrength.meterValue ? passwordStrength.meterColorClassName : 'bg-slate-200',
                        )}
                      />
                    ))}
                  </div>
                  <span className={cn('text-xs font-semibold whitespace-nowrap', passwordStrength.labelClassName)}>
                    {passwordStrength.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-ran-slate">{passwordStrength.helper}</p>
              </div>
            </div>

            <div>
              <Label htmlFor="confirm-password" className="mb-1.5 block">Confirmar contraseña</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirm_new_password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••••"
                  className="h-11 rounded-xl pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className={cn(
              'flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
              passwordStrength.level === 'segura' && 'border border-emerald-200 bg-emerald-50 text-emerald-800',
              passwordStrength.level === 'media' && 'border border-amber-200 bg-amber-50 text-amber-800',
              passwordStrength.level === 'debil' && 'border border-red-200 bg-red-50 text-red-800',
            )}>
              {passwordStrength.level === 'debil' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <p>
                La contraseña no se mostrará nuevamente después de guardar. {passwordStrength.level !== 'segura'
                  ? 'Te recomendamos usar una contraseña segura para esta cuenta.'
                  : 'La contraseña actual cumple una buena base de seguridad.'}
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-xl px-3 text-ran-navy hover:bg-ran-ice"
              onClick={handleGeneratePassword}
              disabled={isUpdatingPassword}
            >
              <RefreshCw className="h-4 w-4" />
              Generar contraseña automática
            </Button>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmpleadoPasswordTarget(null)}
              disabled={isUpdatingPassword}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-ran-navy hover:bg-ran-navy/90"
              onClick={handleChangeEmpleadoPassword}
              disabled={isUpdatingPassword}
            >
              {isUpdatingPassword ? 'Guardando...' : 'Guardar contraseña'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
