import type { Workbook as ExcelWorkbook, Worksheet } from 'exceljs'
import { supabase } from '@/lib/supabase'
import { fetchPaginatedRows } from '@/lib/supabase-pagination'
import { formatDate } from '@/lib/utils'
import type { Cierre, Profile, Servicio } from '@/types/domain.types'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type ExcelWorkbookConstructor = new () => ExcelWorkbook

type CellValue = string | number | null

export interface CierreReportRow {
  servicio: Servicio
  cierre: Cierre | null
}

export interface ExportCierresReportInput {
  fechaInicio: string
  fechaFin: string
}

export interface ExportCierresReportResult {
  filename: string
  totalCierres: number
}

let excelWorkbookConstructorPromise: Promise<ExcelWorkbookConstructor> | null = null

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  )
}

function assertDateRange(input: ExportCierresReportInput) {
  if (!isValidIsoDate(input.fechaInicio) || !isValidIsoDate(input.fechaFin)) {
    throw new Error('Selecciona una fecha inicial y final válidas para el reporte de cierres.')
  }

  if (input.fechaInicio > input.fechaFin) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.')
  }
}

async function getExcelWorkbookConstructor(): Promise<ExcelWorkbookConstructor> {
  if (!excelWorkbookConstructorPromise) {
    excelWorkbookConstructorPromise = import('exceljs').then((module) => {
      const namespace = module as unknown as {
        default?: { Workbook?: ExcelWorkbookConstructor }
        Workbook?: ExcelWorkbookConstructor
      }
      const WorkbookCtor = namespace.default?.Workbook ?? namespace.Workbook

      if (!WorkbookCtor) {
        throw new Error('No se pudo inicializar la librería de Excel para el reporte de cierres.')
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
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1_000)
}

function getProfileName(profile: Partial<Profile> | null | undefined): string {
  return profile?.nombre?.trim() || ''
}

function getCierreTecnicoName(row: CierreReportRow): string {
  return getProfileName(row.cierre?.tecnico) || getProfileName(row.servicio.tecnico)
}

function getCierreAviso(row: CierreReportRow): number | null {
  return row.cierre?.aviso ?? row.servicio.aviso ?? null
}

function getCierreCosto(row: CierreReportRow): number {
  const cierreTotal = Number(row.cierre?.costo_total ?? NaN)
  if (Number.isFinite(cierreTotal)) return cierreTotal

  const servicioTotal = Number(row.servicio.total ?? NaN)
  return Number.isFinite(servicioTotal) ? servicioTotal : 0
}

function getCierreDescripcion(row: CierreReportRow): string {
  return (row.cierre?.descripcion ?? row.servicio.descripcion ?? '').trim()
}

function buildFilename(input: ExportCierresReportInput): string {
  return `cierres-${input.fechaInicio}-a-${input.fechaFin}.xlsx`
}

function toBlobBuffer(buffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buffer instanceof Uint8Array) {
    return new Uint8Array(buffer).buffer
  }

  return buffer
}

async function fetchCierreReportRows(input: ExportCierresReportInput): Promise<CierreReportRow[]> {
  const servicios = await fetchPaginatedRows<Servicio>((from, to) => (
    supabase
      .from('servicios')
      .select('*, cliente:clientes(*), maquina:maquinas(*), tecnico:profiles(id, nombre, correo, telefono, role)')
      .eq('status', 'cerrado')
      .not('fecha_cierre', 'is', null)
      .gte('fecha_cierre', input.fechaInicio)
      .lte('fecha_cierre', input.fechaFin)
      .order('fecha_cierre', { ascending: true })
      .order('orden', { ascending: true, nullsFirst: false })
      .range(from, to)
  ))

  if (servicios.length === 0) return []

  const cierres = await fetchPaginatedRows<Cierre>((from, to) => (
    supabase
      .from('cierres')
      .select('*, tecnico:profiles(id, nombre, correo, telefono, role)')
      .in('servicio_id', servicios.map((servicio) => servicio.id))
      .order('created_at', { ascending: false })
      .range(from, to)
  ))

  const cierreByServicioId = new Map<number, Cierre>()
  for (const cierre of cierres) {
    const current = cierreByServicioId.get(cierre.servicio_id)
    if (!current || current.created_at < cierre.created_at) {
      cierreByServicioId.set(cierre.servicio_id, cierre)
    }
  }

  return servicios.map((servicio) => ({
    servicio,
    cierre: cierreByServicioId.get(servicio.id) ?? null,
  }))
}

function configureWorksheet(worksheet: Worksheet) {
  worksheet.name = 'Hoja1'
  worksheet.views = [{ state: 'normal', activeCell: 'A3' }]
  worksheet.columns = [
    { key: 'aviso', width: 14.7 },
    { key: 'parteObjeto', width: 13.7 },
    { key: 'causa', width: 11 },
    { key: 'servicio', width: 82.1 },
    { key: 'costo', width: 19.9 },
    { key: 'tecnico', width: 17.7 },
    { key: 'firma', width: 16 },
  ]
}

function borderStyle() {
  return {
    left: { style: 'thin' as const, color: { argb: 'FF000000' } },
    right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    top: { style: 'thin' as const, color: { argb: 'FF000000' } },
    bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  }
}

function fillStyle(argb: string) {
  return {
    type: 'pattern' as const,
    pattern: 'solid' as const,
    fgColor: { argb },
  }
}

function applyHeaderStyle(worksheet: Worksheet) {
  const row = worksheet.getRow(2)
  const headers = ['AVISO', 'PARTE OBJETO', 'CAUSA', 'SERVICIO', 'COSTO', 'TECNICO', 'FIRMA']
  headers.forEach((header, index) => {
    row.getCell(index + 1).value = header
  })

  for (let column = 1; column <= headers.length; column += 1) {
    const cell = row.getCell(column)
    cell.font = { name: 'Calibri', size: 11, color: { theme: 1 } }
    cell.alignment = { horizontal: column === 2 || column === 5 || column === 6 || column === 7 ? 'left' : 'center' }
    cell.border = {
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
      top: { style: 'thin', color: { argb: 'FF000000' } },
    }
  }
}

function applyBodyStyle(worksheet: Worksheet, rowNumber: number) {
  const row = worksheet.getRow(rowNumber)
  const fill = rowNumber % 2 === 1 ? fillStyle('FFE2F0D9') : fillStyle('FFC6E0B4')

  for (let column = 1; column <= 7; column += 1) {
    const cell = row.getCell(column)
    cell.font = { name: 'Calibri', size: 11, color: { theme: 1 } }
    cell.border = borderStyle()
    cell.fill = column === 2 || column === 3 || column === 6 || column === 7
      ? fillStyle('FFFFFFFF')
      : fill

    if (column === 1) {
      cell.numFmt = '0'
      cell.alignment = { horizontal: 'center' }
    }

    if (column === 5) {
      cell.numFmt = '_-"$"* #,##0.00_-;-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-'
    }
  }
}

function toRowValues(row: CierreReportRow): CellValue[] {
  return [
    getCierreAviso(row),
    row.cierre?.parte_objeto ?? '',
    row.cierre?.causa ?? '',
    getCierreDescripcion(row),
    getCierreCosto(row),
    getCierreTecnicoName(row),
    row.cierre?.firma_receptor ?? '',
  ]
}

function fillCierresWorksheet(worksheet: Worksheet, rows: CierreReportRow[]) {
  configureWorksheet(worksheet)
  applyHeaderStyle(worksheet)

  rows.forEach((row, index) => {
    const rowNumber = index + 3
    const excelRow = worksheet.getRow(rowNumber)
    toRowValues(row).forEach((value, columnIndex) => {
      excelRow.getCell(columnIndex + 1).value = value
    })
    applyBodyStyle(worksheet, rowNumber)
    excelRow.commit()
  })
}

export async function buildCierresReportBuffer(rows: CierreReportRow[]): Promise<ArrayBuffer | Uint8Array> {
  const WorkbookCtor = await getExcelWorkbookConstructor()
  const workbook = new WorkbookCtor()
  const worksheet = workbook.addWorksheet('Hoja1')
  fillCierresWorksheet(worksheet, rows)

  return workbook.xlsx.writeBuffer()
}

export async function buildCierresReportBlob(rows: CierreReportRow[]): Promise<Blob> {
  const buffer = await buildCierresReportBuffer(rows)
  return new Blob([toBlobBuffer(buffer)], { type: XLSX_MIME })
}

export async function exportCierresReport(input: ExportCierresReportInput): Promise<ExportCierresReportResult> {
  assertDateRange(input)
  const rows = await fetchCierreReportRows(input)

  if (rows.length === 0) {
    throw new Error(`No hay cierres registrados del ${formatDate(input.fechaInicio)} al ${formatDate(input.fechaFin)}.`)
  }

  const filename = buildFilename(input)
  const blob = await buildCierresReportBlob(rows)
  downloadBlob(filename, blob)

  return {
    filename,
    totalCierres: rows.length,
  }
}
