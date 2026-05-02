import type { Workbook as ExcelWorkbook } from 'exceljs'
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

type ExcelWorkbookConstructor = new () => ExcelWorkbook

let excelWorkbookConstructorPromise: Promise<ExcelWorkbookConstructor> | null = null

async function getExcelWorkbookConstructor(): Promise<ExcelWorkbookConstructor> {
  if (!excelWorkbookConstructorPromise) {
    excelWorkbookConstructorPromise = import('exceljs').then((module) => {
      const namespace = module as unknown as {
        default?: { Workbook?: ExcelWorkbookConstructor }
        Workbook?: ExcelWorkbookConstructor
      }
      const WorkbookCtor = namespace.default?.Workbook ?? namespace.Workbook

      if (!WorkbookCtor) {
        throw new Error('No se pudo inicializar la libreria de Excel.')
      }

      return WorkbookCtor
    })
  }

  return excelWorkbookConstructorPromise
}

function downloadBlob(filename: string, blob: Blob) {
  const fileUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = fileUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(fileUrl)
}

export async function exportServiciosExcel({
  servicios,
  filename,
  periodLabel,
}: ExportServiciosOptions): Promise<void> {
  const WorkbookCtor = await getExcelWorkbookConstructor()
  const workbook = new WorkbookCtor()
  const worksheet = workbook.addWorksheet('Servicios')

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

  worksheet.addRows(summaryRows)
  worksheet.addRow(Object.keys(serviceRows[0] ?? {
    Orden: '',
    Aviso: '',
    Status: '',
    Fecha: '',
    'Tipo servicio': '',
    'Clase orden': '',
    'Codigo cliente': '',
    Cliente: '',
    Tecnico: '',
    'Costo mano de obra': '',
    Refacciones: '',
    Total: '',
    Descripcion: '',
  }))

  for (const row of serviceRows) {
    worksheet.addRow(Object.values(row))
  }

  worksheet.columns = [
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 34 },
    { width: 24 },
    { width: 20 },
    { width: 18 },
    { width: 14 },
    { width: 45 },
  ]

  worksheet.getRow(5).font = { bold: true }
  worksheet.getRow(5).alignment = { vertical: 'middle' }
  worksheet.autoFilter = {
    from: 'A5',
    to: `M${Math.max(5, serviceRows.length + 5)}`,
  }

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(filename, new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
}
