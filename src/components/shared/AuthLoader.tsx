import { cn } from '@/lib/utils'

type AuthLoaderVariant = 'mobile' | 'desktop' | 'responsive'

interface AuthLoaderProps {
  title?: string
  description?: string
  fullScreen?: boolean
  className?: string
  variant?: AuthLoaderVariant
}

export function AuthLoader({
  title = 'Preparando tu acceso',
  description = 'Esto toma solo unos segundos.',
  fullScreen = false,
  className,
  variant = 'responsive',
}: AuthLoaderProps) {
  const mobileCard = (
    <div
      className={cn(
        'w-full max-w-sm rounded-[30px] border border-white/75 bg-white/92 px-6 py-6 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.42)] backdrop-blur',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#1B3B6F_0%,#2563EB_62%,#7dd3fc_100%)] shadow-[0_20px_44px_-24px_rgba(37,99,235,0.55)]">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <span className="absolute inset-[-10px] rounded-full border-2 border-white/25 border-t-white/85 animate-spin" />
          <img src="/icons/Ran_logo.png" alt="" className="relative h-7 w-auto drop-shadow-[0_6px_12px_rgba(0,0,0,0.22)]" />
        </div>
      </div>

      <div className="mt-5 text-center">
        <p className="text-sm font-semibold text-ran-navy">{title}</p>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        ) : null}
      </div>

      <div className="ran-auth-loader mt-4" aria-hidden="true">
        <div className="ran-auth-loader__fill" />
      </div>
    </div>
  )

  const desktopCard = (
    <div
      className={cn(
        'w-full max-w-sm rounded-[30px] border border-slate-200/80 bg-white px-7 py-7 shadow-[0_34px_90px_-52px_rgba(15,23,42,0.32)]',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-[linear-gradient(155deg,#f8fbff_0%,#e0ecff_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_18px_42px_-28px_rgba(37,99,235,0.42)]">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <span className="absolute inset-[-8px] rounded-full border border-ran-blue/15" />
          <span className="absolute inset-[-8px] rounded-full border-2 border-transparent border-r-sky-300/80 border-t-ran-blue/85 animate-spin" />
          <img src="/icons/Ran_logo.png" alt="" className="relative h-6.5 w-auto drop-shadow-[0_6px_12px_rgba(37,99,235,0.15)]" />
        </div>
      </div>

      <div className="mt-5 text-center">
        <p className="text-sm font-semibold text-ran-navy">{title}</p>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        ) : null}
      </div>

      <div className="ran-auth-loader-desktop mt-4" aria-hidden="true">
        <span className="ran-auth-loader-desktop__bar" />
        <span className="ran-auth-loader-desktop__bar" />
        <span className="ran-auth-loader-desktop__bar" />
      </div>
    </div>
  )

  const card = variant === 'mobile'
    ? mobileCard
    : variant === 'desktop'
      ? desktopCard
      : (
        <>
          <div className="lg:hidden">{mobileCard}</div>
          <div className="hidden lg:block">{desktopCard}</div>
        </>
      )

  if (!fullScreen) {
    return card
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eef3fb_42%,#f8fafc_100%)] px-6">
      {card}
    </div>
  )
}
