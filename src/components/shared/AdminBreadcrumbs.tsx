import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminBreadcrumbsProps {
  items: Array<string | null | undefined>
  className?: string
}

export function AdminBreadcrumbs({ items, className }: AdminBreadcrumbsProps) {
  const crumbs = items
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 0)

  if (crumbs.length < 2) return null

  return (
    <nav aria-label="Breadcrumb" className={cn('mb-3', className)}>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-ran-slate">
        {crumbs.map((item, index) => {
          const isCurrent = index === crumbs.length - 1

          return (
            <Fragment key={`${item}-${index}`}>
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
              <li className={cn('min-w-0', isCurrent && 'font-semibold text-ran-navy')}>
                <span className="break-words">{item}</span>
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
