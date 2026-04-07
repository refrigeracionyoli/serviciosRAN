import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  title?: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  title = 'Sin resultados',
  description = 'No se encontraron registros.',
  action,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-white py-16 px-8 text-center">
      <Inbox className="mb-4 h-10 w-10 text-ran-slate/40" />
      <h3 className="text-sm font-semibold text-ran-navy">{title}</h3>
      <p className="mt-1 text-sm text-ran-slate">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
