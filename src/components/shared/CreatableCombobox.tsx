import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  value: string | null | undefined
  options: string[]
  onChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  allowClear?: boolean
  clearLabel?: string
  disabled?: boolean
  className?: string
  contentClassName?: string
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase('es')
}

export function CreatableCombobox({
  value,
  options,
  onChange,
  placeholder = 'Seleccionar opción',
  searchPlaceholder = 'Escribe para buscar o crear…',
  allowClear = false,
  clearLabel = 'Sin especificar',
  disabled,
  className,
  contentClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const cleanedValue = value?.trim() ?? ''
  const normalizedSearch = normalizeValue(search)

  const normalizedOptions = useMemo(() => {
    const map = new Map<string, string>()

    options.forEach((option) => {
      const cleanedOption = option.trim()
      if (!cleanedOption) return

      const key = normalizeValue(cleanedOption)
      if (!map.has(key)) {
        map.set(key, cleanedOption)
      }
    })

    return Array.from(map.values())
  }, [options])

  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) return normalizedOptions

    return normalizedOptions.filter((option) =>
      normalizeValue(option).includes(normalizedSearch),
    )
  }, [normalizedOptions, normalizedSearch])

  const hasExactMatch = useMemo(() => {
    if (!normalizedSearch) return false

    return normalizedOptions.some(
      (option) => normalizeValue(option) === normalizedSearch,
    )
  }, [normalizedOptions, normalizedSearch])

  const canCreate = search.trim().length > 0 && !hasExactMatch

  useEffect(() => {
    if (!open) return

    setSearch(cleanedValue)
  }, [open, cleanedValue])

  const handleSelect = (nextValue: string | null) => {
    onChange(nextValue)
    setOpen(false)
    setSearch('')
  }

  const selectedLabel = cleanedValue || (allowClear ? clearLabel : placeholder)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-11 w-full justify-between rounded-xl font-normal', className)}
        >
          <span
            className={cn(
              'truncate',
              !cleanedValue && !allowClear && 'text-muted-foreground',
            )}
          >
            {selectedLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[var(--radix-popover-trigger-width)] p-2', contentClassName)}
        align="start"
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return

            event.preventDefault()

            const typedValue = search.trim()
            if (!typedValue) {
              if (filteredOptions.length > 0) {
                handleSelect(filteredOptions[0])
              }
              return
            }

            if (canCreate) {
              handleSelect(typedValue)
              return
            }

            const matchedOption = filteredOptions.find(
              (option) => normalizeValue(option) === normalizeValue(typedValue),
            )

            if (matchedOption) {
              handleSelect(matchedOption)
              return
            }

            handleSelect(typedValue)
          }}
          placeholder={searchPlaceholder}
          className="mb-2 h-10"
          autoFocus
        />

        <div className="max-h-60 overflow-y-auto">
          {allowClear && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-ran-ice',
                !cleanedValue && 'bg-ran-ice',
              )}
            >
              <Check
                className={cn(
                  'h-4 w-4 shrink-0',
                  !cleanedValue ? 'text-ran-navy opacity-100' : 'opacity-0',
                )}
              />
              {clearLabel}
            </button>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => handleSelect(search.trim())}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium hover:bg-ran-ice"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Usar "{search.trim()}"
            </button>
          )}

          {filteredOptions.map((option) => {
            const isSelected = cleanedValue
              ? normalizeValue(option) === normalizeValue(cleanedValue)
              : false

            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
              className={cn(
                  'flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm hover:bg-ran-ice',
                  isSelected && 'bg-ran-ice',
                )}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isSelected ? 'text-ran-navy opacity-100' : 'opacity-0',
                  )}
                />
                <span className="flex-1 break-words text-left leading-snug">{option}</span>
              </button>
            )
          })}

          {filteredOptions.length === 0 && !canCreate && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Sin coincidencias</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
