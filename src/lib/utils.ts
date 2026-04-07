import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount)
}

function parseToValidDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null

  const parsed = (() => {
    if (date instanceof Date) return date

    const value = date.trim()
    if (!value) return null

    // Strings ISO-only-date should be interpreted as local midnight.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00`)
    }

    return new Date(value)
  })()

  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function formatDate(date: string | Date | null | undefined): string {
  const d = parseToValidDate(date)
  if (!d) return '—'

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

export function formatDateTime(date: string | Date | null | undefined): string {
  const d = parseToValidDate(date)
  if (!d) return '—'

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/** Formatea una fecha como semana Heineken: S0426 = semana 04 del año 2026 */
export function formatWeek(date: Date = new Date()): string {
  const year = date.getFullYear().toString().slice(-2)
  const startOfYear = new Date(date.getFullYear(), 0, 1)
  const week = Math.ceil(
    ((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
  )
  return `S${String(week).padStart(2, '0')}${year}`
}

/** Retorna el rango de fechas de una semana ISO */
export function getWeekRange(date: Date = new Date()): { inicio: string; fin: string } {
  const day = date.getDay()
  const diffToMonday = (day === 0 ? -6 : 1 - day)
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    inicio: monday.toISOString().split('T')[0],
    fin: sunday.toISOString().split('T')[0],
  }
}
