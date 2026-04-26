import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Eye, EyeOff, Info, ShieldCheck, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useActualizarPerfilActualMutation,
  useAuth,
  useCambiarPasswordActualMutation,
} from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/offline/network'
import { cn } from '@/lib/utils'
import {
  actualizarPerfilSchema,
  cambiarPasswordActualSchema,
  type ActualizarPerfilInput,
  type CambiarPasswordActualInput,
} from '@/schemas/profile.schema'
import { useSyncStore } from '@/stores/sync.store'

type PasswordStrengthLevel = 'debil' | 'media' | 'segura'

interface PasswordStrengthResult {
  level: PasswordStrengthLevel
  label: string
  helper: string
  meterValue: 1 | 2 | 3
  meterColorClassName: string
  labelClassName: string
}

interface ProfileSettingsPanelProps {
  variant?: 'dialog' | 'page'
}

function getRoleLabel(role: 'admin' | 'tecnico'): string {
  return role === 'admin' ? 'Administrador' : 'Técnico'
}

function getInitial(name: string): string {
  const value = name.trim().charAt(0)
  return value ? value.toUpperCase() : '?'
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

export function ProfileSettingsPanel({ variant = 'page' }: ProfileSettingsPanelProps) {
  const { perfil } = useAuth()
  const { toast } = useToast()
  const isOnline = useSyncStore((state) => state.isOnline)
  const { mutateAsync: actualizarPerfil, isPending: isSavingProfile } = useActualizarPerfilActualMutation()
  const { mutateAsync: cambiarPassword, isPending: isSavingPassword } = useCambiarPasswordActualMutation()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const profileForm = useForm<ActualizarPerfilInput>({
    resolver: zodResolver(actualizarPerfilSchema),
    defaultValues: {
      nombre: perfil?.nombre ?? '',
      correo: perfil?.correo ?? '',
      telefono: perfil?.telefono ?? '',
    },
  })

  const passwordForm = useForm<CambiarPasswordActualInput>({
    resolver: zodResolver(cambiarPasswordActualSchema),
    defaultValues: {
      password: '',
      confirmar_password: '',
    },
  })

  useEffect(() => {
    if (!perfil) return

    profileForm.reset({
      nombre: perfil.nombre,
      correo: perfil.correo,
      telefono: perfil.telefono ?? '',
    })
  }, [perfil, profileForm])

  if (!perfil) {
    return null
  }

  const sectionClass = variant === 'dialog'
    ? 'rounded-2xl border border-slate-200 bg-white p-4 md:p-5'
    : 'rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_16px_38px_-32px_rgba(15,23,42,0.28)]'
  const summaryClass = variant === 'dialog'
    ? sectionClass
    : 'rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_38px_-32px_rgba(15,23,42,0.28)]'
  const buttonClass = variant === 'dialog' ? 'rounded-xl' : 'rounded-2xl'
  const strength = evaluatePasswordStrength(passwordForm.watch('password') ?? '')

  const handleProfileSubmit = profileForm.handleSubmit(async (values) => {
    try {
      const result = await actualizarPerfil(values)

      profileForm.reset({
        nombre: result.profile.nombre,
        correo: result.profile.correo,
        telefono: result.profile.telefono ?? '',
      })

      const description = result.emailRequiresConfirmation
        ? result.syncStatus === 'pending'
          ? 'Tus cambios se guardaron localmente. Confirma el nuevo correo y la actualización pendiente se terminará de sincronizar cuando la conexión esté estable.'
          : 'Tus datos se actualizaron. Revisa tu correo para confirmar la nueva dirección de acceso.'
        : result.syncStatus === 'pending'
          ? 'Los cambios se guardaron en este dispositivo y se sincronizarán al reconectar.'
          : 'Tu información se actualizó correctamente.'

      toast({
        title: result.syncStatus === 'pending' ? 'Perfil guardado offline' : 'Perfil actualizado',
        description,
      })
    } catch (error) {
      toast({
        title: 'No se pudo actualizar tu perfil',
        description: getErrorMessage(error, 'Ocurrió un error al guardar tus datos.'),
        variant: 'destructive',
      })
    }
  })

  const handlePasswordSubmit = passwordForm.handleSubmit(async (values) => {
    try {
      await cambiarPassword({ password: values.password })
      passwordForm.reset({
        password: '',
        confirmar_password: '',
      })
      setShowPassword(false)
      setShowConfirmPassword(false)

      toast({
        title: 'Contraseña actualizada',
        description: 'Tu contraseña de acceso se actualizó correctamente.',
      })
    } catch (error) {
      toast({
        title: 'No se pudo actualizar tu contraseña',
        description: getErrorMessage(error, 'Ocurrió un error al actualizar tu contraseña.'),
        variant: 'destructive',
      })
    }
  })

  return (
    <div className="space-y-4">
      <section className={summaryClass}>
        <div className="flex items-start gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ran-navy text-lg font-bold text-white">
            {getInitial(perfil.nombre)}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Mi cuenta
            </p>
            <h2 className="mt-1 text-lg font-bold text-ran-navy">{perfil.nombre}</h2>
            <p className="truncate text-sm text-ran-slate">{perfil.correo}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                {getRoleLabel(perfil.role)}
              </Badge>
              {!isOnline && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  Modo offline
                </Badge>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 rounded-xl bg-ran-ice p-2 text-ran-navy">
            <Info className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ran-navy">Información general</h3>
            <p className="mt-1 text-sm text-ran-slate">
              Actualiza tu nombre, correo y teléfono. Si no tienes internet, puedes guardar nombre y teléfono para sincronizarlos después.
            </p>
          </div>
        </div>

        <form className="mt-4 space-y-4" onSubmit={handleProfileSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor={`perfil-nombre-${variant}`} className="mb-1.5 block">Nombre completo</Label>
              <Input
                id={`perfil-nombre-${variant}`}
                className="h-11 rounded-xl"
                autoComplete="name"
                {...profileForm.register('nombre')}
              />
              {profileForm.formState.errors.nombre && (
                <p className="mt-1 text-xs text-destructive">{profileForm.formState.errors.nombre.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor={`perfil-correo-${variant}`} className="mb-1.5 block">Correo</Label>
              <Input
                id={`perfil-correo-${variant}`}
                className="h-11 rounded-xl"
                autoComplete="email"
                disabled={!isOnline}
                {...profileForm.register('correo')}
              />
              <p className="mt-1 text-xs text-ran-slate">
                {isOnline
                  ? 'Este correo se usa para acceder a la cuenta.'
                  : 'Para cambiar el correo necesitas conexión a internet.'}
              </p>
              {profileForm.formState.errors.correo && (
                <p className="mt-1 text-xs text-destructive">{profileForm.formState.errors.correo.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor={`perfil-telefono-${variant}`} className="mb-1.5 block">Teléfono</Label>
              <Input
                id={`perfil-telefono-${variant}`}
                className="h-11 rounded-xl"
                autoComplete="tel"
                {...profileForm.register('telefono')}
              />
              {profileForm.formState.errors.telefono && (
                <p className="mt-1 text-xs text-destructive">{profileForm.formState.errors.telefono.message}</p>
              )}
            </div>
          </div>

          {!isOnline && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Sin conexión: el correo queda bloqueado, pero nombre y teléfono sí pueden guardarse localmente.</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              className={cn('h-11 bg-ran-navy px-5 text-white hover:bg-ran-navy/92', buttonClass)}
              disabled={isSavingProfile || !profileForm.formState.isDirty}
            >
              {isSavingProfile ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </section>

      <section className={sectionClass}>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 rounded-xl bg-ran-ice p-2 text-ran-navy">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ran-navy">Seguridad</h3>
            <p className="mt-1 text-sm text-ran-slate">
              Cambia tu contraseña para proteger el acceso a tu cuenta.
            </p>
          </div>
        </div>

        <form className="mt-4 space-y-4" onSubmit={handlePasswordSubmit}>
          <div>
            <Label htmlFor={`perfil-password-${variant}`} className="mb-1.5 block">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id={`perfil-password-${variant}`}
                type={showPassword ? 'text' : 'password'}
                className="h-11 rounded-xl pr-10"
                autoComplete="new-password"
                disabled={!isOnline}
                {...passwordForm.register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                disabled={!isOnline}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordForm.formState.errors.password && (
              <p className="mt-1 text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>
            )}

            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="grid w-24 grid-cols-3 gap-1" aria-hidden>
                  {[0, 1, 2].map((index) => (
                    <span
                      key={index}
                      className={cn(
                        'h-1.5 rounded-full transition-colors',
                        index < strength.meterValue ? strength.meterColorClassName : 'bg-slate-200',
                      )}
                    />
                  ))}
                </div>
                <span className={cn('text-xs font-semibold', strength.labelClassName)}>
                  {strength.label}
                </span>
              </div>
              <p className="text-xs text-ran-slate">{strength.helper}</p>
            </div>
          </div>

          <div>
            <Label htmlFor={`perfil-confirm-password-${variant}`} className="mb-1.5 block">Confirmar contraseña</Label>
            <div className="relative">
              <Input
                id={`perfil-confirm-password-${variant}`}
                type={showConfirmPassword ? 'text' : 'password'}
                className="h-11 rounded-xl pr-10"
                autoComplete="new-password"
                disabled={!isOnline}
                {...passwordForm.register('confirmar_password')}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                disabled={!isOnline}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordForm.formState.errors.confirmar_password && (
              <p className="mt-1 text-xs text-destructive">{passwordForm.formState.errors.confirmar_password.message}</p>
            )}
          </div>

          {!isOnline && (
            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Conéctate a internet para cambiar la contraseña de acceso.</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              className={cn('h-11 bg-ran-navy px-5 text-white hover:bg-ran-navy/92', buttonClass)}
              disabled={isSavingPassword || !isOnline}
            >
              {isSavingPassword ? 'Actualizando...' : 'Actualizar contraseña'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
