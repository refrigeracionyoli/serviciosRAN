import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { useClientesQuery } from '@/hooks/use-clientes'
import type { Cliente } from '@/types/domain.types'

interface Props {
  value: number | null
  onChange: (value: number | null, cliente: Cliente | null) => void
  disabled?: boolean
}

export function ClienteCombobox({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: clientes = [], isLoading } = useClientesQuery()

  const selected = clientes.find((c) => c.id === value) ?? null

  const filtered = clientes.filter(
    (c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.codigo_cliente.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate">{selected.nombre}</span>
          ) : (
            <span className="text-muted-foreground">Seleccionar cliente…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-2" align="start">
        <Input
          placeholder="Buscar por nombre o código…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
          autoFocus
        />
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Sin resultados</p>
          ) : (
            filtered.map((cliente) => (
              <button
                key={cliente.id}
                type="button"
                onClick={() => {
                  onChange(cliente.id, cliente)
                  setOpen(false)
                  setSearch('')
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-ran-ice',
                  value === cliente.id && 'bg-ran-ice',
                )}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    value === cliente.id ? 'text-ran-navy opacity-100' : 'opacity-0',
                  )}
                />
                <div>
                  <p className="font-medium">{cliente.nombre}</p>
                  <p className="text-xs text-ran-slate">
                    {cliente.codigo_cliente}
                    {cliente.municipio ? ` · ${cliente.municipio}` : ''}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
