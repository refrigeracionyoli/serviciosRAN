import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getEdgeAuthHeaders } from '@/lib/edge-auth'
import { cn } from '@/lib/utils'

interface Props {
  endpoint: string
  payload: Record<string, unknown>
  filename: string
  label?: string
  className?: string
  disabled?: boolean
}

export function ExportButton({
  endpoint,
  payload,
  filename,
  label = 'Exportar Excel',
  className,
  disabled,
}: Props) {
  const [isLoading, setIsLoading] = useState(false)

  const handleExport = async () => {
    setIsLoading(true)
    try {
      const authHeaders = await getEdgeAuthHeaders()

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Error al generar el reporte: ${err}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={disabled || isLoading}
      className={cn('gap-2', className)}
    >
      <Download className="h-4 w-4" />
      {isLoading ? 'Generando…' : label}
    </Button>
  )
}
