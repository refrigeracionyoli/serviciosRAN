import type { Workbook as ExcelWorkbook } from 'exceljs'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { MaquinaEnTaller, MaquinaTallerMovimiento } from '@/types/domain.types'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type ExcelWorkbookConstructor = new () => ExcelWorkbook

interface SalidaTallerResumen {
  maquina_taller_id: number | null
  motivo: string
  destino: string | null
  fecha_movimiento: string
  created_at: string
}

export interface ExportMaquinasTallerReportOptions {
  registros: MaquinaEnTaller[]
  movimientos?: MaquinaTallerMovimiento[]
  filename?: string
  scopeLabel?: string
}

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

function normalizeLower(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? ''
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getDaysInWorkshop(registro: MaquinaEnTaller): number | '' {
  const entrada = parseDateOnly(registro.fecha_entrada)
  if (!entrada) return ''

  const salida = parseDateOnly(registro.fecha_salida) ?? new Date()
  const diff = salida.getTime() - entrada.getTime()
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

function getLastSalidaByRegistroId(movimientos: MaquinaTallerMovimiento[]): Record<number, SalidaTallerResumen> {
  const result: Record<number, SalidaTallerResumen> = {}
  const salidas = movimientos
    .filter((movimiento) => movimiento.accion === 'salida' && movimiento.maquina_taller_id !== null)
    .map((movimiento) => ({
      maquina_taller_id: movimiento.maquina_taller_id,
      motivo: movimiento.motivo,
      destino: movimiento.destino,
      fecha_movimiento: movimiento.fecha_movimiento,
      created_at: movimiento.created_at,
    }))
    .sort((left, right) => `${right.fecha_movimiento}|${right.created_at}`.localeCompare(`${left.fecha_movimiento}|${left.created_at}`))

  for (const salida of salidas) {
    if (!salida.maquina_taller_id) continue
    if (!result[salida.maquina_taller_id]) {
      result[salida.maquina_taller_id] = salida
    }
  }

  return result
}

function getLastMovementByRegistroId(movimientos: MaquinaTallerMovimiento[]): Record<number, MaquinaTallerMovimiento> {
  const result: Record<number, MaquinaTallerMovimiento> = {}
  const sorted = [...movimientos].sort((left, right) => (
    `${right.fecha_movimiento}|${right.created_at}`.localeCompare(`${left.fecha_movimiento}|${left.created_at}`)
  ))

  for (const movimiento of sorted) {
    if (!movimiento.maquina_taller_id) continue
    if (!result[movimiento.maquina_taller_id]) {
      result[movimiento.maquina_taller_id] = movimiento
    }
  }

  return result
}

function getCategoriaLabel(registro: MaquinaEnTaller, salida?: SalidaTallerResumen): string {
  if (!registro.fecha_salida) return 'En taller'

  const motivo = normalizeLower(salida?.motivo)
  const destino = normalizeLower(salida?.destino)

  if (motivo.includes('urban') || destino.includes('urban')) return 'Enviado a Urban'
  if (motivo.includes('instal')) return 'Instalada'
  return 'Cerrada'
}

function formatDestinoSalida(destino: string | null | undefined): string {
  if (!destino) return ''
  const normalized = normalizeLower(destino)

  if (normalized.includes('urban')) return 'Urban'
  if (normalized === 'cliente' || normalized.startsWith('cliente:')) return 'Cliente'
  return destino
}

function buildFilename(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `maquinas-taller-${year}-${month}-${day}.xlsx`
}

function toBlobBuffer(buffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buffer instanceof Uint8Array) {
    return new Uint8Array(buffer).buffer
  }

  return buffer
}

function downloadBlob(filename: string, blob: Blob) {
  const fileUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = fileUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1_000)
}

export async function exportMaquinasTallerReport({
  registros,
  movimientos = [],
  filename = buildFilename(),
  scopeLabel = 'Inventario de taller',
}: ExportMaquinasTallerReportOptions): Promise<void> {
  const WorkbookCtor = await getExcelWorkbookConstructor()
  const workbook = new WorkbookCtor()
  const worksheet = workbook.addWorksheet('Maquinas taller')
  const salidaByRegistroId = getLastSalidaByRegistroId(movimientos)
  const lastMovementByRegistroId = getLastMovementByRegistroId(movimientos)

  const rows = registros.map((registro) => {
    const salida = salidaByRegistroId[registro.id]
    const lastMovement = lastMovementByRegistroId[registro.id]

    return {
      Estado: getCategoriaLabel(registro, salida),
      Serie: registro.maquina?.serie ?? `Maquina #${registro.maquina_id}`,
      Modelo: registro.maquina?.modelo ?? '',
      Cliente: registro.cliente?.nombre ?? registro.maquina?.cliente?.nombre ?? '',
      'Codigo cliente': registro.cliente?.codigo_cliente ?? registro.maquina?.cliente?.codigo_cliente ?? '',
      'Orden servicio': registro.orden ?? '',
      'Fecha entrada': formatDate(registro.fecha_entrada),
      'Fecha salida': formatDate(registro.fecha_salida),
      'Dias en taller': getDaysInWorkshop(registro),
      Destino: formatDestinoSalida(salida?.destino),
      Diagnostico: registro.diagnostico ?? '',
      'Ultimo movimiento': lastMovement ? `${lastMovement.accion} · ${lastMovement.motivo}` : '',
      'Fecha ultimo movimiento': formatDate(lastMovement?.fecha_movimiento),
      'Detalle ultimo movimiento': lastMovement?.detalle ?? '',
    }
  })

  worksheet.addRows([
    ['Reporte de maquinas en taller'],
    [`Alcance: ${scopeLabel}`],
    [`Generado: ${formatDateTime(new Date())}`],
    [`Total de registros: ${rows.length}`],
    [],
  ])

  const headers = Object.keys(rows[0] ?? {
    Estado: '',
    Serie: '',
    Modelo: '',
    Cliente: '',
    'Codigo cliente': '',
    'Orden servicio': '',
    'Fecha entrada': '',
    'Fecha salida': '',
    'Dias en taller': '',
    Destino: '',
    Diagnostico: '',
    'Ultimo movimiento': '',
    'Fecha ultimo movimiento': '',
    'Detalle ultimo movimiento': '',
  })

  worksheet.addRow(headers)
  for (const row of rows) {
    worksheet.addRow(Object.values(row))
  }

  worksheet.columns = [
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 34 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
    { width: 50 },
    { width: 24 },
    { width: 20 },
    { width: 50 },
  ]

  worksheet.views = [{ state: 'frozen', ySplit: 6 }]
  worksheet.getRow(6).font = { bold: true }
  worksheet.getRow(6).alignment = { vertical: 'middle' }
  worksheet.autoFilter = {
    from: 'A6',
    to: `N${Math.max(6, rows.length + 6)}`,
  }

  for (let rowNumber = 7; rowNumber <= rows.length + 6; rowNumber += 1) {
    worksheet.getRow(rowNumber).alignment = { vertical: 'top', wrapText: true }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(filename, new Blob([toBlobBuffer(buffer)], { type: XLSX_MIME }))
}
