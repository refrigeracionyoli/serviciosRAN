import { CalendarIcon, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  value: string | null | undefined
  onChange: (value: string | null) => void
  placeholder?: string
  disabled?: boolean
  maxDate?: string | Date
  allowClear?: boolean
  className?: string
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null

  const cleaned = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null

  const [year, month, day] = cleaned.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

function formatToIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function parseLimitDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null

  if (value instanceof Date) {
    const parsed = new Date(value.getFullYear(), value.getMonth(), value.getDate())
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return parseDateValue(value)
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  disabled,
  maxDate,
  allowClear = false,
  className,
}: Props) {
  const selectedDate = parseDateValue(value)
  const maxAllowedDate = parseLimitDate(maxDate)

  const handleSelectDate = (date: Date | undefined) => {
    if (!date) return

    if (maxAllowedDate && date > maxAllowedDate) {
      return
    }

    onChange(formatToIsoDate(date))
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'h-11 w-full justify-start overflow-hidden rounded-xl text-left font-normal',
              !selectedDate && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {selectedDate ? format(selectedDate, "PPP", { locale: es }) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate ?? undefined}
            onSelect={handleSelectDate}
            toDate={maxAllowedDate ?? undefined}
            disabled={maxAllowedDate ? { after: maxAllowedDate } : undefined}
            initialFocus
            locale={es}
          />
        </PopoverContent>
      </Popover>

      {allowClear && selectedDate && !disabled && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          onClick={() => onChange(null)}
          aria-label="Limpiar fecha"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
