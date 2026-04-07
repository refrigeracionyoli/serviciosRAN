import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  value: string | number
  subtitle?: string
  dotColor?: string
  className?: string
}

export function KpiCard({ title, value, subtitle, dotColor = 'bg-slate-500', className }: Props) {
  return (
    <Card className={cn('rounded-3xl border-slate-200/80 shadow-[0_8px_20px_-16px_rgba(15,23,42,0.35)]', className)}>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <p className="text-3xl font-medium text-slate-500">{title}</p>
          <span className={cn('mt-1 h-2.5 w-2.5 rounded-full', dotColor)} />
        </div>

        <div className="space-y-1">
          <p className="text-6xl font-extrabold leading-none tracking-tight text-slate-900">{value}</p>
          {subtitle && <p className="text-3xl text-slate-500">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
