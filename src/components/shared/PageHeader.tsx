import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 px-5 pt-5 lg:px-7 lg:pt-7', className)}>
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">{title}</h1>
        {description && <p className="text-lg text-ran-slate">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
