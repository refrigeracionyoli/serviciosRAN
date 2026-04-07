import { CalendarIcon, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  from: string | null | undefined
  to: string | null | undefined
  onChange: (from: string | null, to: string | null) => void
  placeholder?: string
  disabled?: boolean
  maxDate?: string | Date
  allowClear?: boolean
  className?: string
}

function parseDateValue(value: string | null | undefined): Date | undefined {
  if (!value) return undefined

  const cleaned = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined

  const [year, month, day] = cleaned.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined
  }

  return parsed
}

function formatToIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function parseLimitDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined

  if (value instanceof Date) {
    const parsed = new Date(value.getFullYear(), value.getMonth(), value.getDate())
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return parseDateValue(value)
}

export function DateRangePickerInput({
  from,
  to,
  onChange,
  placeholder = 'Seleccionar rango',
  disabled,
  maxDate,
  allowClear = true,
  className,
}: Props) {
  const maxAllowedDate = parseLimitDate(maxDate)
  const fromDate = parseDateValue(from)
  const toDate = parseDateValue(to)
  const hasValue = Boolean(fromDate || toDate)

  const label = (() => {
    if (!fromDate && !toDate) return placeholder
    if (fromDate && toDate) {
      if (formatToIsoDate(fromDate) === formatToIsoDate(toDate)) {
        return format(fromDate, 'PPP', { locale: es })
      }
      return `${format(fromDate, 'dd/MM/yyyy')} - ${format(toDate, 'dd/MM/yyyy')}`
    }
    if (fromDate) return `Desde ${format(fromDate, 'dd/MM/yyyy')}`
    return `Hasta ${format(toDate!, 'dd/MM/yyyy')}`
  })()

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'h-11 w-full justify-start rounded-xl text-left font-normal',
              !hasValue && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{
              from: fromDate,
              to: toDate,
            }}
            onSelect={(range) => {
              const nextFrom = range?.from ? formatToIsoDate(range.from) : null
              const nextTo = range?.to ? formatToIsoDate(range.to) : nextFrom
              onChange(nextFrom, nextTo)
            }}
            toDate={maxAllowedDate ?? undefined}
            disabled={maxAllowedDate ? { after: maxAllowedDate } : undefined}
            numberOfMonths={2}
            initialFocus
            locale={es}
          />
        </PopoverContent>
      </Popover>

      {allowClear && hasValue && !disabled && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          onClick={() => onChange(null, null)}
          aria-label="Limpiar rango de fecha"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
