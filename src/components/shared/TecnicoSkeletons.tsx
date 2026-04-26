import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function HeroPulse({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-full bg-white/20', className)} aria-hidden="true" />
}

function WhiteCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.28)]', className)}>
      {children}
    </section>
  )
}

function MobileActionGridSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={`tecnico-action-skeleton-${index}`} className="h-10 rounded-xl" />
      ))}
    </div>
  )
}

function MobileListCardSkeleton({
  withBody = true,
  actions = 4,
}: {
  withBody?: boolean
  actions?: number
}) {
  return (
    <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_-32px_rgba(15,23,42,0.26)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="mt-2 h-5 w-40 rounded-full" />
          <Skeleton className="mt-2 h-3.5 w-28 rounded-full" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="mt-4 space-y-2">
        <Skeleton className="h-3.5 w-full rounded-full" />
        <Skeleton className="h-3.5 w-3/4 rounded-full" />
        <Skeleton className="h-3.5 w-2/3 rounded-full" />
      </div>

      {withBody ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-5/6 rounded-full" />
        </div>
      ) : null}

      <div className={cn('mt-4 grid gap-2', actions === 2 ? 'grid-cols-2' : 'grid-cols-2')}>
        {Array.from({ length: actions }).map((_, index) => (
          <Skeleton key={`tecnico-list-card-action-${index}`} className="h-10 rounded-xl" />
        ))}
      </div>
    </article>
  )
}

function MobileDetailCardSkeleton() {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-3.5 py-3 shadow-[0_14px_32px_-30px_rgba(15,23,42,0.2)]">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded-full" />
        <Skeleton className="h-3 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-full rounded-full" />
      <Skeleton className="mt-2 h-4 w-4/5 rounded-full" />
    </div>
  )
}

function MobileGradientHeroSkeleton({
  titleWidth = 'w-40',
  subtitleWidth = 'w-28',
  stats = 3,
}: {
  titleWidth?: string
  subtitleWidth?: string
  stats?: number
}) {
  return (
    <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_22px_50px_-36px_rgba(15,23,42,0.28)]">
      <div className="bg-[linear-gradient(135deg,rgba(27,59,111,1),rgba(37,99,235,0.92))] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="h-9 w-9 rounded-xl border border-white/20 bg-white/10" />
          <div className="min-w-0 flex-1">
            <HeroPulse className="h-3 w-24" />
            <HeroPulse className={cn('mt-3 h-6 max-w-full', titleWidth)} />
            <HeroPulse className={cn('mt-2 h-3.5 max-w-full', subtitleWidth)} />
          </div>
          <div className="h-6 w-20 rounded-full border border-white/20 bg-white/10" />
        </div>

        <div className="mt-4 space-y-2">
          <HeroPulse className="h-3.5 w-full" />
          <HeroPulse className="h-3.5 w-4/5" />
          <HeroPulse className="h-3.5 w-1/2" />
        </div>
      </div>

      <div className={cn('grid gap-2 px-4 py-3', stats === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {Array.from({ length: stats }).map((_, index) => (
          <div
            key={`tecnico-hero-stat-${index}`}
            className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5"
          >
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="mt-2 h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  )
}

export function TecnicoPageLoadingSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <WhiteCard>
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="mt-2 h-7 w-40 rounded-full" />
        <Skeleton className="mt-2 h-4 w-32 rounded-full" />
      </WhiteCard>

      <WhiteCard>
        <div className="space-y-2">
          <Skeleton className="h-4 w-36 rounded-full" />
          <Skeleton className="h-3.5 w-56 rounded-full" />
        </div>
        <div className="mt-4 space-y-2.5">
          <MobileListCardSkeleton actions={2} />
          <MobileListCardSkeleton actions={2} />
        </div>
      </WhiteCard>

      <WhiteCard>
        <MobileActionGridSkeleton count={3} />
      </WhiteCard>
    </div>
  )
}

export function TecnicoHomeSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <WhiteCard>
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="mt-2 h-7 w-36 rounded-full" />
        <Skeleton className="mt-2 h-4 w-28 rounded-full" />
        <Skeleton className="mt-3 h-4 w-48 rounded-full" />
      </WhiteCard>

      <section className="space-y-2.5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-3.5 w-48 rounded-full" />
        </div>
        <MobileListCardSkeleton />
        <MobileListCardSkeleton />
      </section>

      <section className="space-y-2.5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-3.5 w-56 rounded-full" />
        </div>
        <MobileListCardSkeleton withBody={false} actions={2} />
      </section>
    </div>
  )
}

export function TecnicoServicioDetalleSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <MobileGradientHeroSkeleton />

      <WhiteCard>
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="mt-2 h-5 w-40 rounded-full" />
        <Skeleton className="mt-3 h-4 w-full rounded-full" />
        <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
      </WhiteCard>

      <section className="space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-3.5 w-44 rounded-full" />
        </div>
        <div className="grid gap-2.5">
          <MobileDetailCardSkeleton />
          <MobileDetailCardSkeleton />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <MobileDetailCardSkeleton />
            <MobileDetailCardSkeleton />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="h-3.5 w-44 rounded-full" />
        </div>
        <div className="grid gap-2.5">
          <MobileDetailCardSkeleton />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <MobileDetailCardSkeleton />
            <MobileDetailCardSkeleton />
          </div>
          <MobileDetailCardSkeleton />
        </div>
      </section>

      <WhiteCard>
        <Skeleton className="h-3 w-20 rounded-full" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-5/6 rounded-full" />
          <Skeleton className="h-4 w-3/4 rounded-full" />
        </div>
      </WhiteCard>

      <MobileActionGridSkeleton count={3} className="sm:grid-cols-3" />
    </div>
  )
}

export function TecnicoInventarioSkeleton() {
  return (
    <div className="space-y-3.5 px-3.5 py-4">
      <WhiteCard className="overflow-hidden p-0">
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24 rounded-full" />
              <Skeleton className="mt-2 h-6 w-40 rounded-full" />
              <Skeleton className="mt-2 h-4 w-full rounded-full" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Skeleton className="h-[72px] rounded-[18px]" />
            <Skeleton className="h-[72px] rounded-[18px]" />
          </div>

          <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5">
            <Skeleton className="h-3 w-28 rounded-full" />
            <Skeleton className="mt-3 h-10 rounded-xl" />
          </div>
        </div>
      </WhiteCard>

      <WhiteCard>
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="mt-2 h-4 w-56 rounded-full" />
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,1fr)_110px_auto]">
          <Skeleton className="h-9 rounded-xl" />
          <Skeleton className="h-9 rounded-xl" />
          <Skeleton className="h-9 rounded-xl" />
        </div>
      </WhiteCard>

      <WhiteCard className="p-3.5">
        <Skeleton className="h-9 rounded-xl" />
      </WhiteCard>

      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, index) => (
          <article
            key={`tecnico-inventario-item-skeleton-${index}`}
            className="rounded-[20px] border border-slate-200 bg-white p-3.5 shadow-[0_14px_32px_-30px_rgba(15,23,42,0.24)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-36 rounded-full" />
                <Skeleton className="mt-2 h-3.5 w-full rounded-full" />
                <Skeleton className="mt-2 h-3.5 w-28 rounded-full" />
              </div>
              <div className="w-16 space-y-2">
                <Skeleton className="ml-auto h-5 w-10 rounded-full" />
                <Skeleton className="ml-auto h-3 w-14 rounded-full" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Skeleton className="h-8.5 w-24 rounded-xl" />
              <Skeleton className="h-8.5 w-24 rounded-xl" />
              <Skeleton className="h-8.5 w-14 rounded-xl" />
              <Skeleton className="h-8.5 w-28 rounded-xl" />
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function TecnicoRefaccionesSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <MobileGradientHeroSkeleton stats={3} />

      <WhiteCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="mt-2 h-5 w-44 rounded-full" />
            <Skeleton className="mt-2 h-4 w-full rounded-full" />
          </div>
          <Skeleton className="h-10 w-full rounded-xl sm:w-24" />
        </div>

        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 2 }).map((_, index) => (
            <article
              key={`tecnico-refacciones-row-skeleton-${index}`}
              className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5"
            >
              <div className="grid gap-3">
                <div>
                  <Skeleton className="h-3 w-20 rounded-full" />
                  <Skeleton className="mt-2 h-9 rounded-xl bg-white" />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div>
                    <Skeleton className="h-3 w-16 rounded-full" />
                    <Skeleton className="mt-2 h-9 rounded-xl bg-white" />
                  </div>
                  <Skeleton className="mt-5 h-9 w-9 rounded-xl" />
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div>
                    <Skeleton className="h-3 w-20 rounded-full" />
                    <Skeleton className="mt-2 h-4 w-12 rounded-full" />
                  </div>
                  <div>
                    <Skeleton className="h-3 w-24 rounded-full" />
                    <Skeleton className="mt-2 h-4 w-12 rounded-full" />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="my-4 h-px bg-slate-200" />

        <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl bg-white" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded-full" />
              <Skeleton className="h-3.5 w-full rounded-full" />
            </div>
          </div>
        </div>
      </WhiteCard>

      <WhiteCard>
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-5 w-48 rounded-full" />
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-4 h-20 rounded-[20px]" />
        <div className="mt-4 grid gap-2.5">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      </WhiteCard>
    </div>
  )
}

export function TecnicoEvidenciaSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <MobileGradientHeroSkeleton stats={2} />

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Skeleton className="h-9 rounded-xl sm:w-28" />
            <Skeleton className="h-9 rounded-xl sm:w-24" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={`tecnico-foto-skeleton-${index}`} className="aspect-square rounded-[20px]" />
          ))}
        </div>
      </section>

      <WhiteCard>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28 rounded-full" />
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-4 w-56 rounded-full" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-2xl bg-white" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded-full" />
              <Skeleton className="h-3.5 w-32 rounded-full" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 flex-1 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>
      </WhiteCard>

      <WhiteCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-5 w-44 rounded-full" />
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-xl sm:w-28" />
        </div>
      </WhiteCard>

      <WhiteCard>
        <Skeleton className="h-20 rounded-[20px]" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-5/6 rounded-full" />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      </WhiteCard>
    </div>
  )
}

export function TecnicoPerfilSkeleton() {
  return (
    <div className="space-y-4 px-3.5 py-4">
      <WhiteCard>
        <Skeleton className="h-3 w-16 rounded-full" />
        <Skeleton className="mt-2 h-6 w-28 rounded-full" />
        <Skeleton className="mt-2 h-4 w-56 rounded-full" />
      </WhiteCard>

      <WhiteCard>
        <div className="flex items-start gap-3.5">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-4 w-40 rounded-full" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>
      </WhiteCard>

      <WhiteCard>
        <div className="flex items-start gap-2">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="mt-2 h-11 rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="mt-2 h-11 rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-2 h-11 rounded-xl" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Skeleton className="h-11 w-36 rounded-2xl" />
        </div>
      </WhiteCard>

      <WhiteCard>
        <div className="flex items-start gap-2">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-48 rounded-full" />
          </div>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <Skeleton className="h-3 w-28 rounded-full" />
            <Skeleton className="mt-2 h-11 rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-3 w-36 rounded-full" />
            <Skeleton className="mt-2 h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <div className="grid w-24 grid-cols-3 gap-1">
              <Skeleton className="h-1.5 rounded-full" />
              <Skeleton className="h-1.5 rounded-full" />
              <Skeleton className="h-1.5 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-full rounded-full" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Skeleton className="h-11 w-40 rounded-2xl" />
        </div>
      </WhiteCard>
    </div>
  )
}
