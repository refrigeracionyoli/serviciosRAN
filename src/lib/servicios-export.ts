import * as XLSX from 'xlsx'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Servicio } from '@/types/domain.types'

interface ExportServiciosOptions {
  servicios: Servicio[]
  filename: string
  periodLabel: string
}

function getServicioReferenceDate(servicio: Servicio): string | null {
  return servicio.fecha_servicio ?? servicio.fecha_solicitud ?? servicio.created_at ?? null
}

function getStatusLabel(status: Servicio['status']): string {
  if (status === 'pendiente') return 'Pendiente'
  if (status === 'en_ruta') return 'En ruta'
  if (status === 'completado') return 'Completado'
  return 'Cerrado'
}

export function exportServiciosExcel({
  servicios,
  filename,
  periodLabel,
}: ExportServiciosOptions) {
  const summaryRows = [
    ['Listado de servicios'],
    [`Periodo: ${periodLabel}`],
    [`Generado: ${formatDateTime(new Date())}`],
    [],
  ]

  const serviceRows = servicios.map((servicio) => ({
    Orden: servicio.orden ?? '',
    Aviso: servicio.aviso ?? '',
    Status: getStatusLabel(servicio.status),
    Fecha: formatDate(getServicioReferenceDate(servicio)),
    'Tipo servicio': servicio.tipo_servicio,
    'Clase orden': servicio.clase_orden ?? '',
    'Codigo cliente': servicio.cliente?.codigo_cliente ?? '',
    Cliente: servicio.cliente?.nombre ?? '',
    Tecnico: servicio.tecnico?.nombre ?? '',
    'Costo mano de obra': servicio.costo_mano_obra ?? 0,
    Refacciones: servicio.costo_refacciones ?? 0,
    Total: servicio.total ?? 0,
    Descripcion: servicio.descripcion ?? '',
  }))

  const worksheet = XLSX.utils.aoa_to_sheet(summaryRows)
  XLSX.utils.sheet_add_json(worksheet, serviceRows, { origin: 'A5' })

  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 26 },
    { wch: 14 },
    { wch: 14 },
    { wch: 34 },
    { wch: 24 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 45 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Servicios')
  XLSX.writeFile(workbook, filename, { compression: true })
}