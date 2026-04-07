import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSignIn } from '@/hooks/use-auth'

const loginSchema = z.object({
  email: z.string().email({ message: 'Correo inválido' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
})

type LoginInput = z.infer<typeof loginSchema>

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const { mutate: signIn, isPending, error } = useSignIn()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  const handleLogin = (data: LoginInput) => {
    signIn(
      { email: data.email, password: data.password },
      {
        onSuccess: (result) => {
          const role = (result.perfil as { role?: 'admin' | 'tecnico' }).role
          navigate(role === 'admin' ? '/' : '/tecnico', { replace: true })
        },
      },
    )
  }

  return (
    <div className="flex min-h-screen bg-ran-gray">
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

      <main className="flex flex-1 items-center justify-center p-4 lg:p-10">
        <div className="w-full max-w-[420px] rounded-3xl border border-slate-200/80 bg-white p-7 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.25)] lg:p-8 animate-fade-in">
          <img src="/icons/Ran_logo.png" alt="RAN Refrigeracion" className="mx-auto mb-3 w-[170px] max-w-full lg:hidden" />

          <div className="mb-6">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Iniciar sesion</h2>
            <p className="mt-1 text-sm text-slate-500">Ingresa tus credenciales para acceder</p>
          </div>

          <form onSubmit={handleSubmit(handleLogin)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-bold text-slate-800">
                Correo
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Ej: ran.patytorres@hotmail.com"
                {...register('email')}
                className="h-11 rounded-xl border-slate-300 bg-slate-100/80 px-4 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:ring-ran-navy/25"
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-bold text-slate-800">
                Contraseña
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className="h-11 rounded-xl border-slate-300 bg-slate-100/80 px-4 pr-10 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:ring-ran-navy/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm text-red-700">
                  {error instanceof Error ? error.message : 'Error al iniciar sesión'}
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending}
              className="mt-1 h-11 w-full rounded-xl bg-ran-navy text-sm font-semibold text-white hover:bg-ran-navy/95"
            >
              {isPending ? 'Ingresando...' : 'Ingresar'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">serviciosran.com.mx</p>
        </div>
      </main>
    </div>
  )
}
