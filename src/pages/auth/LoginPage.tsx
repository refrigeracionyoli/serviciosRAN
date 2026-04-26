import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Eye, EyeOff, UserRound, WifiOff } from 'lucide-react'
import { AuthLoader } from '@/components/shared/AuthLoader'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth, useSignIn } from '@/hooks/use-auth'
import { ensureOfflineDbReady } from '@/lib/offline/db'
import { hydrateTecnicoOfflineQueryCache } from '@/lib/offline/tecnico-query-hydration'
import { preloadTecnicoOfflineData } from '@/lib/offline/tecnico-preload'
import { formatLocalIsoDate } from '@/lib/utils'

const loginSchema = z.object({
  email: z.string().email({ message: 'Correo inválido' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
})

type LoginInput = z.infer<typeof loginSchema>

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false)
  const [isPreparingOffline, setIsPreparingOffline] = useState(false)
  const [isManualSignInFlow, setIsManualSignInFlow] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated, perfil, isLoading: loadingAuth } = useAuth()
  const { mutateAsync: signIn, isPending, error } = useSignIn()
  const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  useEffect(() => {
    if (loadingAuth || isManualSignInFlow || !isAuthenticated || !perfil) return
    navigate(perfil.role === 'admin' ? '/' : '/tecnico', { replace: true })
  }, [isAuthenticated, isManualSignInFlow, loadingAuth, navigate, perfil])

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])

  const handleLogin = async (data: LoginInput) => {
    setIsManualSignInFlow(true)

    try {
      const result = await signIn({ email: data.email, password: data.password })
      const role = result.perfil.role

      if (role === 'tecnico') {
        const fecha = formatLocalIsoDate(new Date())
        setIsPreparingOffline(true)

        try {
          await ensureOfflineDbReady({ recover: true })

          if (navigator.onLine) {
            await preloadTecnicoOfflineData(result.perfil.id, result.perfil.id, {
              fecha,
              force: true,
            })
          }

          await hydrateTecnicoOfflineQueryCache(result.perfil.id, queryClient, {
            fecha,
            tecnicoId: result.perfil.id,
          })
        } catch {
          // Si el preload falla, la app sigue pudiendo entrar y reintentar desde el layout.
        } finally {
          setIsPreparingOffline(false)
        }
      }

      navigate(role === 'admin' ? '/' : '/tecnico', { replace: true })
    } catch {
      setIsPreparingOffline(false)
      setIsManualSignInFlow(false)
    }
  }

  const isBusy = isPending || isPreparingOffline
  const loginErrorMessage = error instanceof Error ? error.message : 'No se pudo iniciar sesión.'

  return (
    <>
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#eef3fb] lg:bg-ran-gray lg:flex-row">
        <aside className="relative hidden w-[42%] bg-ran-navy text-white lg:flex lg:flex-col lg:justify-center lg:px-14">
          <div className="absolute -left-16 bottom-[-90px] h-56 w-56 rounded-full bg-white/6" />
          <div className="absolute right-[-100px] top-[-70px] h-64 w-64 rounded-full bg-white/5" />

          <div className="relative max-w-[360px]">
            <img src="/icons/Ran_logo.png" alt="RAN Refrigeracion" className="mb-6 w-[240px] max-w-full" />
            <div className="h-1 w-20 rounded-full bg-white/45" />
            <p className="mt-4 text-2xl font-semibold leading-tight text-white/88">
              Reparacion e Instalacion
              <br />
              de Maquinas de Hielo
            </p>
          </div>
        </aside>

        <main
          className="relative flex min-h-0 flex-1 items-start justify-center overflow-y-auto overscroll-y-contain px-4 pb-6 pt-0 sm:px-6 lg:items-center lg:overflow-hidden lg:px-10 lg:py-10"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="absolute inset-x-0 top-0 h-[240px] bg-[linear-gradient(180deg,#24457d_0%,#2f5a99_58%,#355f9e_58%,#355f9e_74%,#eef3fb_74%,#eef3fb_100%)] lg:hidden" />

          <div className="relative z-10 w-full max-w-[420px] animate-fade-in pt-7 lg:pt-0">
            <div className="flex min-h-[172px] items-center justify-center px-6 lg:hidden">
              <img
                src="/icons/Ran_logo.png"
                alt="Servicios RAN"
                className="w-[188px] max-w-full drop-shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
              />
            </div>

            <div className="rounded-[28px] border border-white/80 bg-white/96 p-6 shadow-[0_28px_56px_-30px_rgba(15,23,42,0.32)] backdrop-blur lg:rounded-3xl lg:border-slate-200/80 lg:bg-white lg:p-8 lg:shadow-[0_20px_40px_-24px_rgba(15,23,42,0.25)]">
              <img src="/icons/Ran_logo.png" alt="Servicios RAN" className="mx-auto mb-4 hidden w-[170px] max-w-full lg:hidden" />

              <div className="mb-6">
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Iniciar sesión</h2>
                <p className="mt-1 text-sm text-slate-500">Ingresa con tus credenciales para acceder.</p>
              </div>

              <form onSubmit={handleSubmit(handleLogin)} className="space-y-4">
                {isOffline && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 lg:rounded-xl">
                    <div className="flex items-start gap-2.5">
                      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                      <p className="text-sm text-amber-800">
                        Sin conexión. Solo podrás entrar si esta cuenta ya había iniciado sesión en este dispositivo.
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-bold text-slate-800">
                    Correo
                  </Label>
                  <div className="relative">
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="Ej: ejemplo@ran.com"
                      {...register('email')}
                      className="h-11 rounded-2xl border-slate-300 bg-slate-100/85 px-4 pr-10 text-base text-slate-800 placeholder:text-slate-400 focus-visible:ring-ran-navy/25 lg:rounded-xl lg:text-sm"
                    />
                    <UserRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-600">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password" className="text-sm font-bold text-slate-800">
                      Contraseña
                    </Label>
                    <button
                      type="button"
                      onClick={() => setShowRecoveryDialog(true)}
                      className="hidden text-xs font-semibold text-ran-blue transition-colors hover:text-ran-navy lg:inline-flex"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>

                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      {...register('password')}
                      className="h-11 rounded-2xl border-slate-300 bg-slate-100/85 px-4 pr-10 text-base text-slate-800 placeholder:text-slate-400 focus-visible:ring-ran-navy/25 lg:rounded-xl lg:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-600">{errors.password.message}</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 shadow-[0_12px_28px_-24px_rgba(239,68,68,0.75)] lg:rounded-xl">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <p className="text-sm leading-5 text-red-700">{loginErrorMessage}</p>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isBusy || (isOffline && !isAuthenticated)}
                  className="mt-2 h-12 w-full rounded-2xl bg-ran-navy text-base font-semibold text-white hover:bg-ran-navy/95 lg:mt-1 lg:h-11 lg:rounded-xl lg:text-sm"
                >
                  {isBusy ? 'Ingresando...' : 'Ingresar'}
                </Button>

                <button
                  type="button"
                  onClick={() => setShowRecoveryDialog(true)}
                  className="mx-auto block text-xs font-semibold text-slate-400 transition-colors hover:text-ran-blue lg:hidden"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </form>
            </div>

            {isBusy ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[28px] bg-[#eef3fb]/78 px-4 backdrop-blur-[5px] lg:rounded-3xl lg:bg-white/72">
                <AuthLoader
                  variant="responsive"
                  title={isPreparingOffline ? 'Preparando tu sesión' : 'Validando acceso'}
                  description={isPreparingOffline ? 'Estamos dejando lista tu jornada para entrar sin fricciones.' : 'Esto toma solo unos segundos.'}
                  className="max-w-[300px]"
                />
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <Dialog open={showRecoveryDialog} onOpenChange={setShowRecoveryDialog}>
        <DialogContent className="max-w-sm rounded-3xl border-slate-200">
          <DialogHeader>
            <DialogTitle>Cambio de contraseña</DialogTitle>
            <DialogDescription>
              Para restablecer tu contraseña, contacta a un administrador. El cambio debe hacerse desde la plataforma administrativa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setShowRecoveryDialog(false)}
              className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
