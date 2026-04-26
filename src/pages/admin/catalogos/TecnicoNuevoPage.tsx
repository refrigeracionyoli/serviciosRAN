import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, ArrowLeft, Eye, EyeOff, Info, RefreshCw } from 'lucide-react'
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useToast } from '@/hooks/use-toast'
import { useCrearTecnicoMutation } from '@/hooks/use-tecnicos'
import { crearTecnicoSchema, type CrearTecnicoInput } from '@/schemas/tecnico.schema'
import { cn } from '@/lib/utils'

function toNullable(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
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

function getRoleLabel(role: 'admin' | 'tecnico'): string {
  return role === 'admin' ? 'Administrador' : 'Técnico'
}

type PasswordStrengthLevel = 'debil' | 'media' | 'segura'

interface PasswordStrengthResult {
  level: PasswordStrengthLevel
  label: string
  helper: string
  meterValue: 1 | 2 | 3
  meterColorClassName: string
  labelClassName: string
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

export function TecnicoNuevoPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { mutate: crearTecnico, isPending } = useCrearTecnicoMutation()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pendingData, setPendingData] = useState<CrearTecnicoInput | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CrearTecnicoInput>({
    resolver: zodResolver(crearTecnicoSchema),
    defaultValues: {
      nombre: '',
      telefono: '',
      correo: '',
      role: 'tecnico',
      activo: true,
      password: '',
      confirmar_password: '',
      notas: '',
    },
  })

  const onSubmit = handleSubmit((data) => {
    setPendingData(data)
    setIsConfirmOpen(true)
  })

  const handleCreateEmpleado = () => {
    if (!pendingData) return

    crearTecnico(
      {
        nombre: pendingData.nombre.trim(),
        telefono: toNullable(pendingData.telefono),
        correo: pendingData.correo.trim().toLowerCase(),
        role: pendingData.role,
        activo: pendingData.activo,
        password: pendingData.password,
        notas: toNullable(pendingData.notas),
      },
      {
        onSuccess: () => {
          setIsConfirmOpen(false)
          setPendingData(null)
          toast({
            title: 'Empleado registrado',
            description: 'La cuenta de acceso fue creada correctamente.',
          })
          navigate('/catalogos/empleados', { replace: true })
        },
        onError: (error) => {
          setIsConfirmOpen(false)
          setPendingData(null)
          toast({
            title: 'Error al registrar empleado',
            description: error instanceof Error ? error.message : 'No se pudo crear la cuenta del empleado.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  const applyGeneratedPassword = () => {
    const generated = generatePassword(12)
    setValue('password', generated, { shouldDirty: true, shouldValidate: true })
    setValue('confirmar_password', generated, { shouldDirty: true, shouldValidate: true })
    setShowPassword(true)
    setShowConfirmPassword(true)
  }

  const previewNombre = watch('nombre') || '—'
  const previewTelefono = watch('telefono') || '—'
  const previewCorreo = watch('correo') || '—'
  const previewRole = getRoleLabel(watch('role') ?? 'tecnico')
  const previewStatus = watch('activo') ? 'Activo' : 'Inactivo'
  const passwordStrength = evaluatePasswordStrength(watch('password') ?? '')

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/catalogos/empleados')}
          className="rounded-lg border border-slate-200 bg-white p-2 text-ran-slate transition-colors hover:bg-ran-ice hover:text-ran-navy"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <AdminBreadcrumbs items={['Catálogos', 'Empleados', 'Nuevo empleado']} className="mb-0" />
      </div>

      <div className="mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Nuevo empleado</h1>
        <p className="mt-1 text-lg text-ran-slate">Crea una cuenta y registra los datos del empleado en el sistema</p>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <section>
          <h2 className="text-2xl font-bold text-ran-navy">1. Información personal</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_0.58fr_0.84fr]">
            <div>
              <Label htmlFor="nombre" className="mb-1.5 block">Nombre completo</Label>
              <Input id="nombre" placeholder="Ej: Hiram Quintanilla" className="h-11 rounded-xl" {...register('nombre')} />
              {errors.nombre && <p className="mt-1 text-xs text-destructive">{errors.nombre.message}</p>}
            </div>
            <div>
              <Label htmlFor="telefono" className="mb-1.5 block">Teléfono</Label>
              <Input id="telefono" placeholder="Ej: 8112345678" className="h-11 rounded-xl" {...register('telefono')} />
              {errors.telefono && <p className="mt-1 text-xs text-destructive">{errors.telefono.message}</p>}
            </div>
            <div>
              <Label htmlFor="correo" className="mb-1.5 block">Correo electrónico</Label>
              <Input id="correo" placeholder="Ej: tecnico@email.com" className="h-11 rounded-xl" {...register('correo')} />
              {errors.correo && <p className="mt-1 text-xs text-destructive">{errors.correo.message}</p>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[0.32fr_0.4fr_1fr]">
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
            <div>
              <Label htmlFor="role" className="mb-1.5 block">Rol de cuenta</Label>
              <Select
                value={watch('role')}
                onValueChange={(value) => setValue('role', value as 'admin' | 'tecnico', { shouldDirty: true, shouldValidate: true })}
              >
                <SelectTrigger id="role" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tecnico">Técnico</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-2xl font-bold text-ran-navy">2. Cuenta de acceso</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[0.8fr_0.72fr_0.72fr]">
            <div>
              <Label htmlFor="correo_acceso" className="mb-1.5 block">Correo de acceso</Label>
              <Input
                id="correo_acceso"
                value={watch('correo')}
                readOnly
                placeholder="Captura el correo en Información personal"
                className="h-11 rounded-xl bg-slate-50 text-ran-navy"
              />
              <p className="mt-1 text-xs text-ran-slate">Este correo será el usuario para iniciar sesión.</p>
            </div>

            <div>
              <Label htmlFor="password" className="mb-1.5 block">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••"
                  className="h-11 rounded-xl pr-10"
                  {...register('password')}
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
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div>
              <Label htmlFor="confirmar_password" className="mb-1.5 block">Confirmar contraseña</Label>
              <div className="relative">
                <Input
                  id="confirmar_password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••••"
                  className="h-11 rounded-xl pr-10"
                  {...register('confirmar_password')}
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
              {errors.confirmar_password && <p className="mt-1 text-xs text-destructive">{errors.confirmar_password.message}</p>}
            </div>
          </div>

          <div className="mt-3">
            <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 text-ran-navy hover:bg-ran-ice" onClick={applyGeneratedPassword}>
              <RefreshCw className="h-4 w-4" />
              Generar contraseña automática
            </Button>
          </div>

          <div className={cn(
            'mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
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
        </section>

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="text-2xl font-bold text-ran-navy">3. Notas adicionales</h2>
          <div className="mt-3">
            <Label htmlFor="notas" className="mb-1.5 block">Observaciones</Label>
            <textarea
              id="notas"
              rows={3}
              placeholder="Observaciones sobre el empleado, área de cobertura, vehículo, etc. (opcional)"
              className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...register('notas')}
            />
            {errors.notas && <p className="mt-1 text-xs text-destructive">{errors.notas.message}</p>}
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 text-xs text-ran-slate lg:grid-cols-6">
            <div>
              <p className="font-semibold uppercase">Nombre</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewNombre}</p>
            </div>
            <div>
              <p className="font-semibold uppercase">Teléfono</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewTelefono}</p>
            </div>
            <div>
              <p className="font-semibold uppercase">Correo</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewCorreo}</p>
            </div>
            <div>
              <p className="font-semibold uppercase">Correo acceso</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewCorreo}</p>
            </div>
            <div>
              <p className="font-semibold uppercase">Rol</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewRole}</p>
            </div>
            <div>
              <p className="font-semibold uppercase">Status</p>
              <p className="mt-0.5 text-sm font-bold text-ran-navy">{previewStatus}</p>
            </div>
          </div>
        </section>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-11 min-w-[140px] rounded-xl"
            onClick={() => navigate('/catalogos/empleados')}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="h-11 min-w-[170px] rounded-xl bg-ran-navy text-base font-semibold hover:bg-ran-navy/90"
            disabled={isPending}
          >
            {isPending ? 'Guardando...' : 'Guardar empleado'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={(open) => {
          setIsConfirmOpen(open)
          if (!open) setPendingData(null)
        }}
        title="Confirmar creación de empleado"
        description={pendingData
          ? `¿Estás seguro de que quieres crear al usuario "${pendingData.nombre}" como ${getRoleLabel(pendingData.role).toLowerCase()}?`
          : 'Verifica la información antes de crear la cuenta.'}
        confirmLabel="Crear empleado"
        cancelLabel="Cancelar"
        onConfirm={handleCreateEmpleado}
        isLoading={isPending}
      />
    </div>
  )
}
