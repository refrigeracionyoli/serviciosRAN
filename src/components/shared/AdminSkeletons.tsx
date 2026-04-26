import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface AdminStatsGridSkeletonProps {
  count?: number
  className?: string
  columnsClassName?: string
}

interface AdminTableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
}

interface AdminCardListSkeletonProps {
  count?: number
  className?: string
}

const TABLE_WIDTHS = ['w-20', 'w-28', 'w-16', 'w-24', 'w-14', 'w-32'] as const

export function AdminMetricCardSkeleton() {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <Skeleton className="h-3.5 w-28 rounded-full" />
      <Skeleton className="mt-3 h-10 w-20 rounded-2xl" />
      <Skeleton className="mt-3 h-3 w-36 rounded-full" />
    </article>
  )
}

export function AdminStatsGridSkeleton({
  count = 4,
  className,
  columnsClassName = 'md:grid-cols-2 xl:grid-cols-4',
}: AdminStatsGridSkeletonProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-3', columnsClassName, className)}>
      {Array.from({ length: count }).map((_, index) => (
        <AdminMetricCardSkeleton key={`admin-metric-skeleton-${index}`} />
      ))}
    </div>
  )
}

export function AdminFilterBarSkeleton({
  className,
  items = ['max-w-md', '', '', ''],
}: {
  className?: string
  items?: string[]
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-4', className)}>
      {items.map((itemClassName, index) => (
        <Skeleton
          key={`admin-filter-skeleton-${index}`}
          className={cn('h-11 w-full rounded-xl', itemClassName)}
        />
      ))}
    </div>
  )
}

export function AdminTableSkeleton({
  rows = 6,
  columns = 6,
  className,
}: AdminTableSkeletonProps) {
  const columnCount = Math.max(1, Math.min(columns, 6))

  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`admin-table-skeleton-${rowIndex}`}
          className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/75 px-4 py-3"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columnCount }).map((__, columnIndex) => (
            <Skeleton
              key={`admin-table-skeleton-${rowIndex}-${columnIndex}`}
              className={cn('h-4 rounded-full', TABLE_WIDTHS[(rowIndex + columnIndex) % TABLE_WIDTHS.length])}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function AdminCardListSkeleton({
  count = 5,
  className,
}: AdminCardListSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`admin-card-list-skeleton-${index}`}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40 rounded-full" />
              <Skeleton className="mt-2 h-3 w-56 rounded-full" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminDetailGridSkeleton({
  cards = 3,
  className,
}: {
  cards?: number
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-3', className)}>
      {Array.from({ length: cards }).map((_, index) => (
        <section
          key={`admin-detail-card-skeleton-${index}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <Skeleton className="h-5 w-32 rounded-full" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 5 }).map((__, lineIndex) => (
              <Skeleton
                key={`admin-detail-card-line-${index}-${lineIndex}`}
                className={cn('h-3.5 rounded-full', lineIndex % 2 === 0 ? 'w-full' : 'w-4/5')}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function AdminPageLoadingSkeleton() {
  return (
    <div className="space-y-4 p-5 lg:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-10 w-72 rounded-2xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-full" />
        </div>
        <Skeleton className="h-11 w-44 rounded-xl" />
      </div>

      <AdminStatsGridSkeleton count={3} columnsClassName="md:grid-cols-2 xl:grid-cols-3" />
      <AdminFilterBarSkeleton className="lg:grid-cols-3" items={['max-w-md', '', '']} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <AdminTableSkeleton rows={6} columns={5} />
      </section>
    </div>
  )
}

export function AdminDashboardSkeleton() {
  return (
    <div className="space-y-4 px-6 pt-5">
      <AdminStatsGridSkeleton />

      <div className="grid gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={`dashboard-action-skeleton-${index}`} className="h-10 rounded-lg bg-white" />
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-3.5 w-56 rounded-full" />
          </div>
          <Skeleton className="h-4 w-20 rounded-full" />
        </header>
        <div className="px-4 py-4">
          <AdminTableSkeleton rows={5} columns={6} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-5 w-44 rounded-full" />
              <Skeleton className="h-3.5 w-40 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="ml-auto h-3 w-12 rounded-full" />
              <Skeleton className="ml-auto h-8 w-16 rounded-2xl" />
            </div>
          </div>
          <div className="mt-5 grid h-[280px] grid-cols-7 items-end gap-3">
            {[42, 74, 58, 90, 36, 64, 78].map((height, index) => (
              <Skeleton
                key={`dashboard-chart-bar-${index}`}
                className="w-full rounded-[18px] bg-slate-100"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-3.5 w-28 rounded-full" />
          </div>
          <div className="flex h-[280px] items-center justify-center">
            <div className="relative">
              <Skeleton className="h-44 w-44 rounded-full" />
              <div className="absolute inset-[28%] rounded-full bg-white" />
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <Skeleton className="h-5 w-44 rounded-full" />
            <Skeleton className="h-3.5 w-32 rounded-full" />
          </div>
          <div className="mt-5 grid h-[260px] grid-cols-6 items-end gap-3">
            {[32, 48, 66, 54, 76, 58].map((height, index) => (
              <Skeleton
                key={`dashboard-area-skeleton-${index}`}
                className="w-full rounded-[18px] bg-slate-100"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-3.5 w-28 rounded-full" />
          </div>
          <div className="mt-4">
            <AdminCardListSkeleton count={4} />
          </div>
        </section>
      </div>
    </div>
  )
}
