import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ServicioStatus, MantenimientoStatus, MaquinaStatus } from '@/types/domain.types'

const servicioStatusConfig: Record<ServicioStatus, { label: string; className: string }> = {
  pendiente: {
    label: 'Pendiente',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  en_ruta: {
    label: 'En ruta',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  completado: {
    label: 'Completado',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  cerrado: {
    label: 'Cerrado',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  },
}

const maquinaStatusConfig: Record<MaquinaStatus, { label: string; className: string }> = {
  operando: { label: 'Operando', className: 'bg-green-100 text-green-800 border-green-200' },
  en_taller: { label: 'En taller', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  baja: { label: 'Baja', className: 'bg-red-100 text-red-800 border-red-200' },
}

interface ServicioStatusBadgeProps {
  status: ServicioStatus
  className?: string
}

export function ServicioStatusBadge({ status, className }: ServicioStatusBadgeProps) {
  const config = servicioStatusConfig[status]
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', config.className, className)}
    >
      {config.label}
    </Badge>
  )
}

interface MaquinaStatusBadgeProps {
  status: MaquinaStatus
  className?: string
}

export function MaquinaStatusBadge({ status, className }: MaquinaStatusBadgeProps) {
  const config = maquinaStatusConfig[status]
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', config.className, className)}
    >
      {config.label}
    </Badge>
  )
}

interface MantenimientoStatusBadgeProps {
  status: MantenimientoStatus
  className?: string
}

export function MantenimientoStatusBadge({ status, className }: MantenimientoStatusBadgeProps) {
  const config =
    status === 'realizado'
      ? { label: 'Realizado', className: 'bg-green-100 text-green-800 border-green-200' }
      : status === 'en_ruta'
        ? { label: 'En ruta', className: 'bg-blue-100 text-blue-800 border-blue-200' }
        : { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-200' }
  return (
    <Badge variant="outline" className={cn('font-medium', config.className, className)}>
      {config.label}
    </Badge>
  )
}
