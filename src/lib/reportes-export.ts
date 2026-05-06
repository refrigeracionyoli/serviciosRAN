import UZIP from 'uzip'
import type { Workbook, Worksheet } from 'exceljs'
import { downloadEvidenciaBlob } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { isOrdenServicioFilename } from '@/lib/tecnico/servicio-evidencias'
import type {
  Cierre,
  Evidencia,
  Servicio,
  ServicioRefaccion,
} from '@/types/domain.types'

const NS = {
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  officeRelationship: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  packageRelationship: 'http://schemas.openxmlformats.org/package/2006/relationships',
  spreadsheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  spreadsheetDrawing: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  docProps: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  docPropsTypes: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
} as const

const WEEKLY_TEMPLATE_URL = `${import.meta.env.BASE_URL}report-templates/formato-semanal-2026.xlsx`
const EVIDENCE_TEMPLATE_URL = `${import.meta.env.BASE_URL}report-templates/formato-evidencias-os.xlsx`
const TEMPLATE_FETCH_CACHE = new Map<string, Promise<ArrayBuffer>>()
const XML_DECODER = new TextDecoder('utf-8')
const XML_ENCODER = new TextEncoder()
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ZIP_MIME = 'application/zip'
const REPORT_PROVIDER_DEFAULT = 4010269
const REPORT_GZ_DEFAULT = 'NUEVO LEON'

export type WeeklyReportExportMode =
  | 'todos'
  | 'instalaciones_retiros'
  | 'mantenimientos'
  | 'ambos'

const WEEKLY_REPORT_MODE_CONFIG: Record<WeeklyReportExportMode, { label: string; slug: string }> = {
  todos: {
    label: 'todos los servicios',
    slug: 'Todos',
  },
  instalaciones_retiros: {
    label: 'instalaciones y retiros',
    slug: 'InstalacionesRetiros',
  },
  mantenimientos: {
    label: 'mantenimientos',
    slug: 'Mantenimientos',
  },
  ambos: {
    label: 'ambos reportes',
    slug: 'Ambos',
  },
}

const PHOTO_SLOTS = [
  {
    labelCell: 'A3',
    contentCell: 'A4',
    from: { col: 0, row: 3 },
    to: { col: 5, row: 23 },
  },
  {
    labelCell: 'F3',
    contentCell: 'F4',
    from: { col: 5, row: 3 },
    to: { col: 10, row: 23 },
  },
  {
    labelCell: 'A24',
    contentCell: 'A25',
    from: { col: 0, row: 24 },
    to: { col: 5, row: 50 },
  },
  {
    labelCell: 'F24',
    contentCell: 'F25',
    from: { col: 5, row: 24 },
    to: { col: 10, row: 50 },
  },
] as const

const GENERAL_SERVICE_SELECT = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, telefono, role)
`

export interface WeeklyReportExportInput {
  semana: string
  fechaInicio: string
  fechaFin: string
  reportMode?: WeeklyReportExportMode
  tecnicoId?: string | null
  clienteId?: number | null
  tipoServicio?: string | null
  tipoServicios?: string[] | null
  clasesOrden?: string[] | null
}

export interface ServiceEvidenceExportBundle {
  servicio: Servicio
  cierre: Cierre | null
  refacciones: ServicioRefaccion[]
  evidencias: Evidencia[]
}

export interface WeeklyReportExportResult {
  filename: string
  totalServicios: number
}

export interface BuildBinaryResult {
  blob: Blob
  filename: string
}

export interface WeeklyReportProgress {
  progress: number
  stage: string
  detail: string
  completedServices: number
  totalServices: number
}

interface BuildWeeklyReportOptions {
  signal?: AbortSignal
  onProgress?: (progress: WeeklyReportProgress) => void
}

interface WeeklyReportWorkerDoneMessage {
  type: 'done'
  filename: string
  totalServicios: number
  buffer: ArrayBuffer
}

interface WeeklyReportWorkerErrorMessage {
  type: 'error'
  name?: string
  message: string
}

interface WeeklyReportWorkerProgressMessage {
  type: 'progress'
  progress: WeeklyReportProgress
}

type WeeklyReportWorkerMessage =
  | WeeklyReportWorkerDoneMessage
  | WeeklyReportWorkerErrorMessage
  | WeeklyReportWorkerProgressMessage

interface BuildServiceEvidenceWorkbookOptions {
  signal?: AbortSignal
  templateBuffer?: ArrayBuffer
}

interface TemplateLookups {
  proveedorDefault: number
  gzDefault: string
  pepByGzAndType: Map<string, PepLookupRecord>
  serviceTypeByBaseAndEquipment: Map<string, ServiceTypeLookupRecord>
}

interface PepLookupRecord {
  pep: string
  nombrePep: string
}

interface ServiceTypeLookupRecord {
  reportType: string
  iniciativa: string
}

interface NormalizedReportService extends ServiceEvidenceExportBundle {
  provider: number
  gz: string
  equipmentType: string
  reportServiceType: string
  pep: string
  pepNombre: string
  refaccionesReportType: string
  refaccionesPep: string
  refaccionesPepNombre: string
  fechaCierreExcel: number | null
  costoServicio: number
  costoRefacciones: number
  comentario: string
}

interface SummaryRow {
  kind: 'servicio' | 'refaccion'
  provider: number
  gz: string
  periodo: string
  tipoServicio: string
  pep: string
  nombrePep: string
  total: number
}

interface SummaryDisplayRow {
  provider: number | null
  gz: string
  periodo: string
  tipoServicio: string
  pep: string
  nombrePep: string
  total: number
}

interface EmbeddedImage {
  bytes: Uint8Array
  extension: 'jpeg' | 'png' | 'gif'
  mimeType: string
}

interface ImageExportProfile {
  maxLongSidePx: number
  initialQuality: number
  minQuality: number
  softLimitBytes: number
}

interface WorksheetImageSlot {
  label: number
  contentCell: string
  from: { col: number; row: number }
  to: { col: number; row: number }
  image: EmbeddedImage | null
  message: string | null
}

interface EvidenceLineItem {
  nombre: string
  cantidad: number
  precioUnitario: number
  subtotal: number
}

type ExcelWorkbook = Workbook
type ExcelWorksheet = Worksheet
type ExcelWorkbookConstructor = new () => ExcelWorkbook

let excelJsWorkbookConstructorPromise: Promise<ExcelWorkbookConstructor> | null = null

const PHOTO_EXPORT_IMAGE_PROFILE: ImageExportProfile = {
  maxLongSidePx: 1100,
  initialQuality: 0.64,
  minQuality: 0.52,
  softLimitBytes: 220 * 1024,
}

const ORDER_EXPORT_IMAGE_PROFILE: ImageExportProfile = {
  maxLongSidePx: 1600,
  initialQuality: 0.72,
  minQuality: 0.58,
  softLimitBytes: 420 * 1024,
}

function normalizeLookupKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function sanitizeFilenamePart(value: string | number | null | undefined): string {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized : 'archivo'
}

function toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') {
    throw new Error('Este navegador no soporta la codificación requerida para exportar imágenes.')
  }

  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function toExcelColumnName(index: number): string {
  let value = index + 1
  let result = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }

  return result
}

function toExcelCellAddress(position: { col: number; row: number }): string {
  return `${toExcelColumnName(position.col)}${position.row + 1}`
}

function toExcelRange(
  from: { col: number; row: number },
  to: { col: number; row: number },
): string {
  return `${toExcelCellAddress(from)}:${toExcelCellAddress(to)}`
}

function createAbortError(): DOMException | Error {
  try {
    return new DOMException('La exportación fue cancelada.', 'AbortError')
  } catch {
    const error = new Error('La exportación fue cancelada.')
    error.name = 'AbortError'
    return error
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

async function yieldToBrowser(signal?: AbortSignal) {
  throwIfAborted(signal)

  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

  throwIfAborted(signal)
}

function emitWeeklyReportProgress(
  options: BuildWeeklyReportOptions | undefined,
  progress: number,
  stage: string,
  detail: string,
  completedServices = 0,
  totalServices = 0,
) {
  options?.onProgress?.({
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    stage,
    detail,
    completedServices,
    totalServices,
  })
}

function normalizeServiceTypeText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function isInstallationOrRetiroService(servicio: Pick<Servicio, 'tipo_servicio'>): boolean {
  const tipoServicio = normalizeServiceTypeText(servicio.tipo_servicio)
  return tipoServicio.includes('INSTALACION') || tipoServicio.includes('RETIRO')
}

function getWeeklyReportMode(input: WeeklyReportExportInput): WeeklyReportExportMode {
  return input.reportMode ?? 'todos'
}

function getWeeklyReportModeConfig(mode: WeeklyReportExportMode) {
  return WEEKLY_REPORT_MODE_CONFIG[mode]
}

function filterBundlesByWeeklyReportMode(
  bundles: ServiceEvidenceExportBundle[],
  mode: WeeklyReportExportMode,
): ServiceEvidenceExportBundle[] {
  if (mode === 'todos' || mode === 'ambos') return bundles
  if (mode === 'instalaciones_retiros') {
    return bundles.filter((bundle) => isInstallationOrRetiroService(bundle.servicio))
  }
  return bundles.filter((bundle) => !isInstallationOrRetiroService(bundle.servicio))
}

function buildNoWeeklyServicesMessage(input: WeeklyReportExportInput): string {
  const mode = getWeeklyReportMode(input)
  if (mode === 'ambos' || mode === 'todos') {
    return 'No hay servicios cerrados en la semana seleccionada para exportar.'
  }

  return `No hay servicios cerrados de ${getWeeklyReportModeConfig(mode).label} en la semana seleccionada.`
}

function withProgressRange(
  options: BuildWeeklyReportOptions | undefined,
  start: number,
  end: number,
): BuildWeeklyReportOptions | undefined {
  if (!options) return undefined

  return {
    ...options,
    onProgress: (progress) => {
      const mappedProgress = start + ((Math.max(0, Math.min(100, progress.progress)) / 100) * (end - start))
      options.onProgress?.({
        ...progress,
        progress: mappedProgress,
      })
    },
  }
}

function xmlText(bytes: Uint8Array): string {
  return XML_DECODER.decode(bytes)
}

function xmlBytes(text: string): Uint8Array {
  return XML_ENCODER.encode(text)
}

function parseXml(bytes: Uint8Array): XMLDocument {
  return new DOMParser().parseFromString(xmlText(bytes), 'application/xml')
}

function serializeXml(document: XMLDocument): Uint8Array {
  return xmlBytes(new XMLSerializer().serializeToString(document))
}

function getRootElement(document: XMLDocument): Element {
  const root = document.documentElement
  if (!root) {
    throw new Error('XML inválido: documento sin raíz.')
  }
  return root
}

function getElementsByLocalName(parent: Document | Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', localName))
}

function getFirstElementByLocalName(parent: Document | Element, localName: string): Element {
  const element = getElementsByLocalName(parent, localName)[0]
  if (!element) {
    throw new Error(`No se encontró el elemento XML "${localName}".`)
  }
  return element
}

function getDirectChildElementsByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName)
}

function getDirectChildElementByLocalName(parent: Element, localName: string): Element | null {
  return getDirectChildElementsByLocalName(parent, localName)[0] ?? null
}

function parseCellReference(reference: string): { column: string; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(reference)
  if (!match) {
    throw new Error(`Referencia de celda inválida: ${reference}`)
  }
  return {
    column: match[1],
    row: Number(match[2]),
  }
}

function getColumnNumber(column: string): number {
  return column.split('').reduce((value, character) => value * 26 + (character.charCodeAt(0) - 64), 0)
}

function setCalcPrForFullRecalc(files: Record<string, Uint8Array>) {
  const workbookDoc = parseXml(files['xl/workbook.xml'])
  const workbookRoot = getRootElement(workbookDoc)
  let calcPr = getDirectChildElementByLocalName(workbookRoot, 'calcPr')

  if (!calcPr) {
    calcPr = workbookDoc.createElementNS(NS.spreadsheet, 'calcPr')
    workbookRoot.appendChild(calcPr)
  }

  calcPr.setAttribute('calcId', calcPr.getAttribute('calcId') ?? '191029')
  calcPr.setAttribute('fullCalcOnLoad', '1')
  calcPr.setAttribute('forceFullCalc', '1')

  files['xl/workbook.xml'] = serializeXml(workbookDoc)
}

function removeCalcChain(files: Record<string, Uint8Array>) {
  delete files['xl/calcChain.xml']

  const contentTypesDoc = parseXml(files['[Content_Types].xml'])
  const contentTypesRoot = getRootElement(contentTypesDoc)
  for (const override of getDirectChildElementsByLocalName(contentTypesRoot, 'Override')) {
    if (override.getAttribute('PartName') === '/xl/calcChain.xml') {
      override.remove()
    }
  }
  files['[Content_Types].xml'] = serializeXml(contentTypesDoc)

  const workbookRelsDoc = parseXml(files['xl/_rels/workbook.xml.rels'])
  const workbookRelsRoot = getRootElement(workbookRelsDoc)
  for (const relationship of getDirectChildElementsByLocalName(workbookRelsRoot, 'Relationship')) {
    if (relationship.getAttribute('Target') === 'calcChain.xml') {
      relationship.remove()
    }
  }
  files['xl/_rels/workbook.xml.rels'] = serializeXml(workbookRelsDoc)
}

function removeWeeklyPivotArtifacts(files: Record<string, Uint8Array>) {
  delete files['xl/pivotCache/pivotCacheDefinition1.xml']
  delete files['xl/pivotCache/pivotCacheRecords1.xml']
  delete files['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels']
  delete files['xl/pivotTables/pivotTable1.xml']
  delete files['xl/pivotTables/_rels/pivotTable1.xml.rels']

  const contentTypesDoc = parseXml(files['[Content_Types].xml'])
  const contentTypesRoot = getRootElement(contentTypesDoc)
  const pivotPartNames = new Set([
    '/xl/pivotCache/pivotCacheDefinition1.xml',
    '/xl/pivotCache/pivotCacheRecords1.xml',
    '/xl/pivotTables/pivotTable1.xml',
  ])

  for (const override of getDirectChildElementsByLocalName(contentTypesRoot, 'Override')) {
    if (pivotPartNames.has(override.getAttribute('PartName') ?? '')) {
      override.remove()
    }
  }
  files['[Content_Types].xml'] = serializeXml(contentTypesDoc)

  const workbookDoc = parseXml(files['xl/workbook.xml'])
  const workbookRoot = getRootElement(workbookDoc)
  const pivotCaches = getDirectChildElementByLocalName(workbookRoot, 'pivotCaches')
  pivotCaches?.remove()
  files['xl/workbook.xml'] = serializeXml(workbookDoc)

  const workbookRelsDoc = parseXml(files['xl/_rels/workbook.xml.rels'])
  const workbookRelsRoot = getRootElement(workbookRelsDoc)
  for (const relationship of getDirectChildElementsByLocalName(workbookRelsRoot, 'Relationship')) {
    if (relationship.getAttribute('Target') === 'pivotCache/pivotCacheDefinition1.xml') {
      relationship.remove()
    }
  }
  files['xl/_rels/workbook.xml.rels'] = serializeXml(workbookRelsDoc)

  const sheetRelsPath = 'xl/worksheets/_rels/sheet4.xml.rels'
  if (!files[sheetRelsPath]) return

  const sheetRelsDoc = parseXml(files[sheetRelsPath])
  const sheetRelsRoot = getRootElement(sheetRelsDoc)
  for (const relationship of getDirectChildElementsByLocalName(sheetRelsRoot, 'Relationship')) {
    if (relationship.getAttribute('Target') === '../pivotTables/pivotTable1.xml') {
      relationship.remove()
    }
  }
  files[sheetRelsPath] = serializeXml(sheetRelsDoc)
}

function getWorksheetDocument(files: Record<string, Uint8Array>, sheetPath: string): XMLDocument {
  const bytes = files[sheetPath]
  if (!bytes) {
    throw new Error(`No se encontró la hoja ${sheetPath} en la plantilla.`)
  }
  return parseXml(bytes)
}

function saveWorksheetDocument(files: Record<string, Uint8Array>, sheetPath: string, document: XMLDocument) {
  files[sheetPath] = serializeXml(document)
}

function getSheetData(document: XMLDocument): Element {
  return getFirstElementByLocalName(document, 'sheetData')
}

function getRows(sheetData: Element): Element[] {
  return getDirectChildElementsByLocalName(sheetData, 'row')
}

function getRow(sheetData: Element, rowNumber: number): Element | null {
  return getRows(sheetData).find((row) => Number(row.getAttribute('r')) === rowNumber) ?? null
}

function updateClonedRowReferences(row: Element, newRowNumber: number) {
  const previousRowNumber = Number(row.getAttribute('r') ?? '0')
  row.setAttribute('r', String(newRowNumber))

  for (const cell of getDirectChildElementsByLocalName(row, 'c')) {
    const previousReference = cell.getAttribute('r')
    if (previousReference) {
      const { column } = parseCellReference(previousReference)
      cell.setAttribute('r', `${column}${newRowNumber}`)
    }

    const formula = getDirectChildElementByLocalName(cell, 'f')
    if (formula?.textContent) {
      const regex = new RegExp(`(?<![A-Z0-9_\\$])([A-Z]{1,3})\\$?${previousRowNumber}(?!\\d)`, 'g')
      formula.textContent = formula.textContent.replace(regex, (_, column: string) => `${column}${newRowNumber}`)
    }
  }
}

function setWorksheetDimension(document: XMLDocument, range: string) {
  const dimension = getFirstElementByLocalName(document, 'dimension')
  dimension.setAttribute('ref', range)
}

function setTableReference(files: Record<string, Uint8Array>, tablePath: string, range: string) {
  const tableDoc = parseXml(files[tablePath])
  const tableRoot = getRootElement(tableDoc)
  tableRoot.setAttribute('ref', range)

  const autoFilter = getDirectChildElementByLocalName(tableRoot, 'autoFilter')
  if (autoFilter) {
    autoFilter.setAttribute('ref', range)
  }

  files[tablePath] = serializeXml(tableDoc)
}

function getCell(row: Element, column: string): Element | null {
  const reference = `${column}${row.getAttribute('r')}`
  return getDirectChildElementsByLocalName(row, 'c').find((cell) => cell.getAttribute('r') === reference) ?? null
}

function ensureCell(document: XMLDocument, row: Element, column: string): Element {
  const existing = getCell(row, column)
  if (existing) return existing

  const cell = document.createElementNS(NS.spreadsheet, 'c')
  cell.setAttribute('r', `${column}${row.getAttribute('r')}`)

  const currentColumnNumber = getColumnNumber(column)
  const cells = getDirectChildElementsByLocalName(row, 'c')
  const nextSibling = cells.find((candidate) => {
    const reference = candidate.getAttribute('r')
    if (!reference) return false
    return getColumnNumber(parseCellReference(reference).column) > currentColumnNumber
  })

  if (nextSibling) {
    row.insertBefore(cell, nextSibling)
  } else {
    row.appendChild(cell)
  }

  return cell
}

function clearCellValue(cell: Element, keepFormula = true) {
  for (const child of [...Array.from(cell.children)]) {
    if (keepFormula && child.localName === 'f') continue
    cell.removeChild(child)
  }

  if (!keepFormula) {
    cell.removeAttribute('t')
    return
  }

  const formula = getDirectChildElementByLocalName(cell, 'f')
  if (!formula) {
    cell.removeAttribute('t')
  } else if (!getDirectChildElementByLocalName(cell, 'v')) {
    const v = cell.ownerDocument.createElementNS(NS.spreadsheet, 'v')
    v.textContent = ''
    cell.appendChild(v)
  }
}

function setInlineString(
  document: XMLDocument,
  row: Element,
  column: string,
  value: string | null | undefined,
  styleId?: number,
) {
  const cell = ensureCell(document, row, column)
  clearCellValue(cell, false)
  if (styleId != null) {
    cell.setAttribute('s', String(styleId))
  }

  if (!value || value.trim().length === 0) {
    cell.removeAttribute('t')
    return
  }

  cell.setAttribute('t', 'inlineStr')
  const inline = document.createElementNS(NS.spreadsheet, 'is')
  const text = document.createElementNS(NS.spreadsheet, 't')
  if (value.startsWith(' ') || value.endsWith(' ')) {
    text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  }
  text.textContent = value
  inline.appendChild(text)
  cell.appendChild(inline)
}

function setNumber(
  document: XMLDocument,
  row: Element,
  column: string,
  value: number | null | undefined,
  styleId?: number,
) {
  const cell = ensureCell(document, row, column)
  clearCellValue(cell, false)
  if (styleId != null) {
    cell.setAttribute('s', String(styleId))
  }

  if (value == null || Number.isNaN(value)) {
    cell.removeAttribute('t')
    return
  }

  cell.removeAttribute('t')
  const v = document.createElementNS(NS.spreadsheet, 'v')
  v.textContent = String(value)
  cell.appendChild(v)
}

function getRowTemplate(sheetData: Element, rowNumber: number): Element {
  const row = getRow(sheetData, rowNumber)
  if (!row) {
    throw new Error(`No se encontró la fila ${rowNumber} en la plantilla.`)
  }
  return row
}

function buildClonedRows(
  templateRow: Element,
  count: number,
  startRow: number,
  fill: (row: Element, index: number) => void,
) {
  const rows: Element[] = []

  for (let index = 0; index < count; index += 1) {
    const row = templateRow.cloneNode(true) as Element
    updateClonedRowReferences(row, startRow + index)
    fill(row, index)
    rows.push(row)
  }

  return rows
}

function replaceRowsFrom(sheetData: Element, startRow: number, rows: Element[]) {
  for (const currentRow of [...getRows(sheetData)]) {
    if (Number(currentRow.getAttribute('r')) >= startRow) {
      currentRow.remove()
    }
  }

  for (const row of rows) {
    sheetData.appendChild(row)
  }
}

function createRow(document: XMLDocument, rowNumber: number, height?: number): Element {
  const row = document.createElementNS(NS.spreadsheet, 'row')
  row.setAttribute('r', String(rowNumber))
  if (height != null) {
    row.setAttribute('ht', String(height))
    row.setAttribute('customHeight', '1')
  }
  return row
}

function insertWorksheetNodeAfterSheetData(document: XMLDocument, node: Element) {
  const root = getRootElement(document)
  const sheetData = getDirectChildElementByLocalName(root, 'sheetData')

  if (sheetData?.nextSibling) {
    root.insertBefore(node, sheetData.nextSibling)
  } else {
    root.appendChild(node)
  }
}

function setWorksheetAutoFilter(document: XMLDocument, range: string | null) {
  const root = getRootElement(document)
  getDirectChildElementByLocalName(root, 'autoFilter')?.remove()

  if (!range) return

  const autoFilter = document.createElementNS(NS.spreadsheet, 'autoFilter')
  autoFilter.setAttribute('ref', range)
  insertWorksheetNodeAfterSheetData(document, autoFilter)
}

function setWorksheetDataValidationList(
  document: XMLDocument,
  cellRef: string,
  values: string[],
) {
  const root = getRootElement(document)
  getDirectChildElementByLocalName(root, 'dataValidations')?.remove()

  if (values.length === 0) return

  const escapedValues = values.map((value) => value.replace(/"/g, '""'))
  const dataValidations = document.createElementNS(NS.spreadsheet, 'dataValidations')
  dataValidations.setAttribute('count', '1')

  const dataValidation = document.createElementNS(NS.spreadsheet, 'dataValidation')
  dataValidation.setAttribute('type', 'list')
  dataValidation.setAttribute('allowBlank', '1')
  dataValidation.setAttribute('showInputMessage', '1')
  dataValidation.setAttribute('showErrorMessage', '1')
  dataValidation.setAttribute('sqref', cellRef)

  const formula1 = document.createElementNS(NS.spreadsheet, 'formula1')
  formula1.textContent = `"${escapedValues.join(',')}"`
  dataValidation.appendChild(formula1)
  dataValidations.appendChild(dataValidation)

  const pageMargins = getDirectChildElementByLocalName(root, 'pageMargins')
  if (pageMargins) {
    root.insertBefore(dataValidations, pageMargins)
  } else {
    root.appendChild(dataValidations)
  }
}

const STYLES_PATH = 'xl/styles.xml'

interface FontSpec {
  bold?: boolean
  size?: number
  colorRgb?: string
  name?: string
  family?: number
  scheme?: 'minor' | 'major'
}

interface BorderEdgeSpec {
  style: 'thin' | 'medium' | 'thick'
  rgb: string
}

interface BorderSpec {
  top?: BorderEdgeSpec
  bottom?: BorderEdgeSpec
  left?: BorderEdgeSpec
  right?: BorderEdgeSpec
}

interface CellXfSpec {
  numFmtId?: number
  fontId: number
  fillId: number
  borderId: number
  horizontal?: 'left' | 'center' | 'right'
  vertical?: 'top' | 'center' | 'bottom'
  pivotButton?: boolean
  wrapText?: boolean
}

interface ResumenStyleSet {
  pageLabel: number
  pageValue: number
  topBar: number
  header: number
  bodyText: number
  bodyTextAlt: number
  bodyNumber: number
  bodyNumberAlt: number
  bodyCurrency: number
  bodyCurrencyAlt: number
  totalLabel: number
  totalCurrency: number
}

const RESUMEN_GREEN_RGB = 'FF008246'
const RESUMEN_WHITE_RGB = 'FFFFFFFF'

function appendFont(document: XMLDocument, fontsElement: Element, spec: FontSpec): number {
  const font = document.createElementNS(NS.spreadsheet, 'font')

  if (spec.bold) {
    font.appendChild(document.createElementNS(NS.spreadsheet, 'b'))
  }

  const size = document.createElementNS(NS.spreadsheet, 'sz')
  size.setAttribute('val', String(spec.size ?? 11))
  font.appendChild(size)

  const color = document.createElementNS(NS.spreadsheet, 'color')
  color.setAttribute('rgb', spec.colorRgb ?? 'FF000000')
  font.appendChild(color)

  const name = document.createElementNS(NS.spreadsheet, 'name')
  name.setAttribute('val', spec.name ?? 'Calibri')
  font.appendChild(name)

  const family = document.createElementNS(NS.spreadsheet, 'family')
  family.setAttribute('val', String(spec.family ?? 2))
  font.appendChild(family)

  if (spec.scheme) {
    const scheme = document.createElementNS(NS.spreadsheet, 'scheme')
    scheme.setAttribute('val', spec.scheme)
    font.appendChild(scheme)
  }

  const index = getDirectChildElementsByLocalName(fontsElement, 'font').length
  fontsElement.appendChild(font)
  fontsElement.setAttribute('count', String(index + 1))
  return index
}

function appendSolidFill(document: XMLDocument, fillsElement: Element, rgb: string): number {
  const fill = document.createElementNS(NS.spreadsheet, 'fill')
  const patternFill = document.createElementNS(NS.spreadsheet, 'patternFill')
  patternFill.setAttribute('patternType', 'solid')

  const fgColor = document.createElementNS(NS.spreadsheet, 'fgColor')
  fgColor.setAttribute('rgb', rgb)
  patternFill.appendChild(fgColor)

  const bgColor = document.createElementNS(NS.spreadsheet, 'bgColor')
  bgColor.setAttribute('indexed', '64')
  patternFill.appendChild(bgColor)

  fill.appendChild(patternFill)

  const index = getDirectChildElementsByLocalName(fillsElement, 'fill').length
  fillsElement.appendChild(fill)
  fillsElement.setAttribute('count', String(index + 1))
  return index
}

function appendBorder(document: XMLDocument, bordersElement: Element, spec: BorderSpec): number {
  const border = document.createElementNS(NS.spreadsheet, 'border')

  for (const edge of ['left', 'right', 'top', 'bottom', 'diagonal'] as const) {
    const edgeElement = document.createElementNS(NS.spreadsheet, edge)
    const edgeSpec = (spec as Record<string, BorderEdgeSpec | undefined>)[edge]

    if (edgeSpec) {
      edgeElement.setAttribute('style', edgeSpec.style)
      const color = document.createElementNS(NS.spreadsheet, 'color')
      color.setAttribute('rgb', edgeSpec.rgb)
      edgeElement.appendChild(color)
    }

    border.appendChild(edgeElement)
  }

  const index = getDirectChildElementsByLocalName(bordersElement, 'border').length
  bordersElement.appendChild(border)
  bordersElement.setAttribute('count', String(index + 1))
  return index
}

function appendCellXf(document: XMLDocument, cellXfsElement: Element, spec: CellXfSpec): number {
  const xf = document.createElementNS(NS.spreadsheet, 'xf')
  xf.setAttribute('numFmtId', String(spec.numFmtId ?? 0))
  xf.setAttribute('fontId', String(spec.fontId))
  xf.setAttribute('fillId', String(spec.fillId))
  xf.setAttribute('borderId', String(spec.borderId))
  xf.setAttribute('xfId', '0')
  xf.setAttribute('applyFont', '1')
  xf.setAttribute('applyFill', '1')
  xf.setAttribute('applyBorder', '1')
  if (spec.pivotButton) {
    xf.setAttribute('pivotButton', '1')
  }

  if (spec.numFmtId != null && spec.numFmtId !== 0) {
    xf.setAttribute('applyNumberFormat', '1')
  }

  if (spec.horizontal || spec.vertical || spec.wrapText) {
    xf.setAttribute('applyAlignment', '1')
    const alignment = document.createElementNS(NS.spreadsheet, 'alignment')
    if (spec.horizontal) alignment.setAttribute('horizontal', spec.horizontal)
    if (spec.vertical) alignment.setAttribute('vertical', spec.vertical)
    if (spec.wrapText) alignment.setAttribute('wrapText', '1')
    xf.appendChild(alignment)
  }

  const index = getDirectChildElementsByLocalName(cellXfsElement, 'xf').length
  cellXfsElement.appendChild(xf)
  cellXfsElement.setAttribute('count', String(index + 1))
  return index
}

function ensureWeeklyResumenStyles(files: Record<string, Uint8Array>): ResumenStyleSet {
  const stylesBytes = files[STYLES_PATH]
  if (!stylesBytes) {
    throw new Error('La plantilla no contiene xl/styles.xml.')
  }

  const document = parseXml(stylesBytes)
  const root = getRootElement(document)
  const fonts = getDirectChildElementByLocalName(root, 'fonts')
  const fills = getDirectChildElementByLocalName(root, 'fills')
  const borders = getDirectChildElementByLocalName(root, 'borders')
  const cellXfs = getDirectChildElementByLocalName(root, 'cellXfs')

  if (!fonts || !fills || !borders || !cellXfs) {
    throw new Error('La plantilla de estilos no tiene la estructura esperada.')
  }

  const bodyFontId = appendFont(document, fonts, { size: 11, colorRgb: 'FF000000', scheme: 'minor' })
  const bodyBoldFontId = appendFont(document, fonts, { bold: true, size: 11, colorRgb: 'FF000000', scheme: 'minor' })
  const headerFontId = appendFont(document, fonts, { bold: true, size: 11, colorRgb: RESUMEN_WHITE_RGB, scheme: 'minor' })
  const titleFontId = headerFontId

  const whiteFillId = appendSolidFill(document, fills, RESUMEN_WHITE_RGB)
  const greenFillId = appendSolidFill(document, fills, RESUMEN_GREEN_RGB)
  const totalBorderId = appendBorder(document, borders, {
    top: { style: 'medium', rgb: RESUMEN_GREEN_RGB },
  })

  const pageLabel = appendCellXf(document, cellXfs, {
    fontId: bodyFontId,
    fillId: whiteFillId,
    borderId: 0,
    horizontal: 'left',
    vertical: 'center',
  })
  const pageValue = appendCellXf(document, cellXfs, {
    fontId: bodyFontId,
    fillId: whiteFillId,
    borderId: 0,
    horizontal: 'left',
    vertical: 'center',
    pivotButton: true,
  })
  const topBar = appendCellXf(document, cellXfs, {
    fontId: titleFontId,
    fillId: greenFillId,
    borderId: 0,
    horizontal: 'left',
    vertical: 'center',
  })
  const header = appendCellXf(document, cellXfs, {
    fontId: headerFontId,
    fillId: greenFillId,
    borderId: 0,
    horizontal: 'left',
    vertical: 'center',
  })
  const bodyText = appendCellXf(document, cellXfs, {
    fontId: bodyFontId,
    fillId: whiteFillId,
    borderId: 0,
    horizontal: 'left',
    vertical: 'center',
  })
  const bodyNumber = appendCellXf(document, cellXfs, {
    fontId: bodyFontId,
    fillId: whiteFillId,
    borderId: 0,
    horizontal: 'right',
    vertical: 'center',
  })
  const bodyCurrency = appendCellXf(document, cellXfs, {
    numFmtId: 44,
    fontId: bodyFontId,
    fillId: whiteFillId,
    borderId: 0,
    horizontal: 'right',
    vertical: 'center',
  })
  const bodyTextAlt = bodyText
  const bodyNumberAlt = bodyNumber
  const bodyCurrencyAlt = bodyCurrency
  const totalLabel = appendCellXf(document, cellXfs, {
    fontId: bodyBoldFontId,
    fillId: whiteFillId,
    borderId: totalBorderId,
    horizontal: 'left',
    vertical: 'center',
  })
  const totalCurrency = appendCellXf(document, cellXfs, {
    numFmtId: 44,
    fontId: bodyBoldFontId,
    fillId: whiteFillId,
    borderId: totalBorderId,
    horizontal: 'right',
    vertical: 'center',
  })

  files[STYLES_PATH] = serializeXml(document)

  return {
    pageLabel,
    pageValue,
    topBar,
    header,
    bodyText,
    bodyTextAlt,
    bodyNumber,
    bodyNumberAlt,
    bodyCurrency,
    bodyCurrencyAlt,
    totalLabel,
    totalCurrency,
  }
}

function loadTemplateArrayBuffer(url: string): Promise<ArrayBuffer> {
  const cached = TEMPLATE_FETCH_CACHE.get(url)
  if (cached) return cached

  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`No se pudo cargar la plantilla ${url} (${response.status}).`)
      }
      return response.arrayBuffer()
    })
    .catch((error: unknown) => {
      TEMPLATE_FETCH_CACHE.delete(url)
      throw error
    })

  TEMPLATE_FETCH_CACHE.set(url, promise)
  return promise
}

function toLookupCellValue(value: unknown): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value == null) return ''

  if (typeof value === 'object') {
    const candidate = value as {
      result?: unknown
      text?: unknown
      richText?: Array<{ text?: unknown }>
    }

    if (typeof candidate.result === 'number' || typeof candidate.result === 'string') {
      return candidate.result
    }

    if (typeof candidate.text === 'string') {
      return candidate.text
    }

    if (Array.isArray(candidate.richText)) {
      return candidate.richText
        .map((part) => typeof part.text === 'string' ? part.text : '')
        .join('')
    }
  }

  return String(value)
}

function readLookupRows(worksheet: ExcelWorksheet, maxColumn: number): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = []

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: Array<string | number> = []

    for (let column = 1; column <= maxColumn; column += 1) {
      values.push(toLookupCellValue(row.getCell(column).value))
    }

    rows.push(values)
  })

  return rows
}

async function loadTemplateLookups(weeklyTemplateBuffer: ArrayBuffer): Promise<TemplateLookups> {
  const WorkbookCtor = await getExcelWorkbookConstructor()
  const workbook = new WorkbookCtor()
  await workbook.xlsx.load(weeklyTemplateBuffer.slice(0))

  const sheet2 = workbook.getWorksheet('Sheet2')
  const catPep = workbook.getWorksheet('CatPEP')
  const caratula = workbook.getWorksheet('Caratula')

  if (!sheet2 || !catPep || !caratula) {
    throw new Error('La plantilla semanal no contiene las hojas requeridas.')
  }

  const typeRows = readLookupRows(sheet2, 4)
  const pepRows = readLookupRows(catPep, 6)

  const serviceTypeByBaseAndEquipment = new Map<string, ServiceTypeLookupRecord>()
  const pepByGzAndType = new Map<string, PepLookupRecord>()

  for (const row of typeRows.slice(1)) {
    const baseServiceType = String(row[0] ?? '').trim()
    const equipmentType = String(row[1] ?? '').trim()
    const reportType = String(row[2] ?? '').trim()
    const iniciativa = String(row[3] ?? '').trim()

    if (!baseServiceType || !equipmentType || !reportType) continue

    serviceTypeByBaseAndEquipment.set(
      `${normalizeLookupKey(baseServiceType)}|${normalizeLookupKey(equipmentType)}`,
      { reportType, iniciativa },
    )
  }

  for (const row of pepRows.slice(1)) {
    const gz = String(row[1] ?? '').trim()
    const pep = String(row[2] ?? '').trim()
    const nombrePep = String(row[3] ?? '').trim()
    const reportType = String(row[5] ?? '').trim()

    if (!gz || !reportType || !pep) continue

    pepByGzAndType.set(
      `${normalizeLookupKey(gz)}|${normalizeLookupKey(reportType)}`,
      { pep, nombrePep },
    )
  }

  const proveedorDefaultCell = toLookupCellValue(caratula.getCell('D15').value)
  const gzDefaultCell = toLookupCellValue(caratula.getCell('D16').value)
  const proveedorDefault = Number(proveedorDefaultCell || REPORT_PROVIDER_DEFAULT) || REPORT_PROVIDER_DEFAULT
  const gzDefault = String(gzDefaultCell || REPORT_GZ_DEFAULT).trim() || REPORT_GZ_DEFAULT

  return {
    proveedorDefault,
    gzDefault,
    pepByGzAndType,
    serviceTypeByBaseAndEquipment,
  }
}

function guessEquipmentType(servicio: Servicio): string {
  const candidates = [
    servicio.maquina?.modelo,
    servicio.descripcion,
    servicio.tipo_servicio,
  ]
    .filter(Boolean)
    .map((value) => normalizeLookupKey(String(value)))

  if (candidates.some((value) => value.includes('CUARTO FRIO') || value.includes('CUARTO FRIO'))) {
    return 'CUARTO FRIO'
  }

  if (candidates.some((value) => value.includes('BARRIL') || value.includes('KEG') || value.includes('CO2'))) {
    return 'BARRIL'
  }

  if (candidates.some((value) => value.includes('HIELO') || value.startsWith('KM'))) {
    return 'MAQUINA HIELO'
  }

  if (candidates.some((value) => value.includes('ENFRIADOR') || value.startsWith('SD') || value.startsWith('MS'))) {
    return 'ENFRIADOR'
  }

  return 'ENFRIADOR'
}

function resolveReportServiceType(
  servicio: Servicio,
  equipmentType: string,
  lookups: TemplateLookups,
): ServiceTypeLookupRecord {
  const exact = lookups.serviceTypeByBaseAndEquipment.get(
    `${normalizeLookupKey(servicio.tipo_servicio)}|${normalizeLookupKey(equipmentType)}`,
  )

  if (exact) return exact

  if (servicio.tipo_servicio.includes(' - ')) {
    return {
      reportType: servicio.tipo_servicio,
      iniciativa: '',
    }
  }

  return {
    reportType: `${servicio.tipo_servicio} - ${equipmentType}`,
    iniciativa: '',
  }
}

function resolvePep(lookups: TemplateLookups, gz: string, reportType: string): PepLookupRecord {
  return lookups.pepByGzAndType.get(
    `${normalizeLookupKey(gz)}|${normalizeLookupKey(reportType)}`,
  ) ?? {
    pep: '',
    nombrePep: '',
  }
}

function parseDateParts(input: string | Date): { year: number; month: number; day: number } {
  if (input instanceof Date) {
    return {
      year: input.getFullYear(),
      month: input.getMonth() + 1,
      day: input.getDate(),
    }
  }

  const isoDate = input.trim().slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) {
    const parsed = new Date(input)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Fecha inválida: ${input}`)
    }
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1,
      day: parsed.getDate(),
    }
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function toExcelDateSerial(input: string | Date | null | undefined): number | null {
  if (!input) return null

  const { year, month, day } = parseDateParts(input)
  const utcTime = Date.UTC(year, month - 1, day)
  return Math.floor((utcTime - Date.UTC(1899, 11, 30)) / 86_400_000)
}

function sumRefacciones(refacciones: ServicioRefaccion[]): number {
  return refacciones.reduce((total, row) => total + (Number(row.subtotal) || (row.cantidad * row.precio_unitario)), 0)
}

function buildEvidenceServiceConcept(servicio: Servicio): string {
  const segments = String(servicio.tipo_servicio ?? '')
    .split(' - ')
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments[0] || 'SERVICIO'
}

function buildEvidenceLineItems(bundle: ServiceEvidenceExportBundle): EvidenceLineItem[] {
  const items: EvidenceLineItem[] = []
  const serviceCost = Number(bundle.servicio.costo_mano_obra ?? 0)

  if (serviceCost > 0) {
    items.push({
      nombre: buildEvidenceServiceConcept(bundle.servicio),
      cantidad: 1,
      precioUnitario: serviceCost,
      subtotal: serviceCost,
    })
  }

  for (const row of bundle.refacciones) {
    items.push({
      nombre: row.nombre_refaccion,
      cantidad: row.cantidad,
      precioUnitario: row.precio_unitario,
      subtotal: Number(row.subtotal) || (row.cantidad * row.precio_unitario),
    })
  }

  return items
}

function normalizeReportService(bundle: ServiceEvidenceExportBundle, lookups: TemplateLookups): NormalizedReportService {
  const provider = lookups.proveedorDefault
  const gz = lookups.gzDefault
  const equipmentType = guessEquipmentType(bundle.servicio)
  const reportTypeLookup = resolveReportServiceType(bundle.servicio, equipmentType, lookups)
  const pepLookup = resolvePep(lookups, gz, reportTypeLookup.reportType)
  const refaccionesReportType = `REFACCIONES - ${equipmentType}`
  const refaccionesPepLookup = resolvePep(lookups, gz, refaccionesReportType)
  const costoRefacciones = sumRefacciones(bundle.refacciones)
  const costoServicio = Number(bundle.servicio.costo_mano_obra ?? 0)
  const fechaCierreSource = bundle.servicio.fecha_cierre
    ?? bundle.cierre?.created_at
    ?? bundle.servicio.fecha_servicio
    ?? bundle.servicio.updated_at

  return {
    ...bundle,
    provider,
    gz,
    equipmentType,
    reportServiceType: reportTypeLookup.reportType,
    pep: pepLookup.pep,
    pepNombre: pepLookup.nombrePep || reportTypeLookup.iniciativa,
    refaccionesReportType,
    refaccionesPep: refaccionesPepLookup.pep,
    refaccionesPepNombre: refaccionesPepLookup.nombrePep,
    fechaCierreExcel: toExcelDateSerial(fechaCierreSource),
    costoServicio,
    costoRefacciones,
    comentario: (bundle.cierre?.descripcion ?? bundle.servicio.descripcion ?? '').trim(),
  }
}

function sortBundles(bundles: ServiceEvidenceExportBundle[]): ServiceEvidenceExportBundle[] {
  return [...bundles].sort((left, right) => {
    const leftDate = left.servicio.fecha_cierre
      ?? left.cierre?.created_at
      ?? left.servicio.fecha_servicio
      ?? left.servicio.created_at
    const rightDate = right.servicio.fecha_cierre
      ?? right.cierre?.created_at
      ?? right.servicio.fecha_servicio
      ?? right.servicio.created_at

    const dateComparison = String(leftDate ?? '').localeCompare(String(rightDate ?? ''))
    if (dateComparison !== 0) return dateComparison

    const leftOrder = left.servicio.orden ?? Number.MAX_SAFE_INTEGER
    const rightOrder = right.servicio.orden ?? Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder

    return left.servicio.id - right.servicio.id
  })
}

async function fetchWeeklyBundles(
  input: WeeklyReportExportInput,
  signal?: AbortSignal,
): Promise<ServiceEvidenceExportBundle[]> {
  let query = supabase
    .from('servicios')
    .select(GENERAL_SERVICE_SELECT)
    .eq('status', 'cerrado')
    .not('fecha_cierre', 'is', null)
    .gte('fecha_cierre', input.fechaInicio)
    .lte('fecha_cierre', input.fechaFin)
    .order('fecha_cierre', { ascending: true })
    .order('orden', { ascending: true, nullsFirst: false })

  if (signal) {
    query = query.abortSignal(signal)
  }

  if (input.tecnicoId) query = query.eq('tecnico_id', input.tecnicoId)
  if (input.clienteId != null) query = query.eq('cliente_id', input.clienteId)
  if (input.tipoServicios?.length) {
    query = query.in('tipo_servicio', input.tipoServicios)
  } else if (input.tipoServicio) {
    query = query.eq('tipo_servicio', input.tipoServicio)
  }
  if (input.clasesOrden?.length) query = query.in('clase_orden', input.clasesOrden)

  const { data: serviciosData, error: serviciosError } = await query
  if (serviciosError) {
    throw new Error(`No se pudieron consultar los servicios del reporte: ${serviciosError.message}`)
  }
  throwIfAborted(signal)

  const servicios = (serviciosData ?? []) as Servicio[]
  if (servicios.length === 0) {
    return []
  }

  const serviceIds = servicios.map((servicio) => servicio.id)

  let cierresQuery = supabase
    .from('cierres')
    .select('*')
    .in('servicio_id', serviceIds)

  let refaccionesQuery = supabase
    .from('servicio_refacciones')
    .select('*')
    .in('servicio_id', serviceIds)
    .order('id')

  let evidenciasQuery = supabase
    .from('evidencias')
    .select('*')
    .in('servicio_id', serviceIds)
    .order('orden')
    .order('created_at')

  if (signal) {
    cierresQuery = cierresQuery.abortSignal(signal)
    refaccionesQuery = refaccionesQuery.abortSignal(signal)
    evidenciasQuery = evidenciasQuery.abortSignal(signal)
  }

  const [cierresResponse, refaccionesResponse, evidenciasResponse] = await Promise.all([
    cierresQuery,
    refaccionesQuery,
    evidenciasQuery,
  ])
  throwIfAborted(signal)

  if (cierresResponse.error) {
    throw new Error(`No se pudieron consultar los cierres del reporte: ${cierresResponse.error.message}`)
  }

  if (refaccionesResponse.error) {
    throw new Error(`No se pudieron consultar las refacciones del reporte: ${refaccionesResponse.error.message}`)
  }

  if (evidenciasResponse.error) {
    throw new Error(`No se pudieron consultar las evidencias del reporte: ${evidenciasResponse.error.message}`)
  }

  const cierreByServicioId = new Map<number, Cierre>()
  for (const cierre of (cierresResponse.data ?? []) as Cierre[]) {
    const previous = cierreByServicioId.get(cierre.servicio_id)
    if (!previous || previous.created_at < cierre.created_at) {
      cierreByServicioId.set(cierre.servicio_id, cierre)
    }
  }

  const refaccionesByServicioId = new Map<number, ServicioRefaccion[]>()
  for (const row of (refaccionesResponse.data ?? []) as ServicioRefaccion[]) {
    if (!row.servicio_id) continue
    const collection = refaccionesByServicioId.get(row.servicio_id) ?? []
    collection.push(row)
    refaccionesByServicioId.set(row.servicio_id, collection)
  }

  const evidenciasByServicioId = new Map<number, Evidencia[]>()
  for (const evidencia of (evidenciasResponse.data ?? []) as Evidencia[]) {
    const collection = evidenciasByServicioId.get(evidencia.servicio_id) ?? []
    collection.push(evidencia)
    evidenciasByServicioId.set(evidencia.servicio_id, collection)
  }

  return sortBundles(
    servicios.map((servicio) => ({
      servicio,
      cierre: cierreByServicioId.get(servicio.id) ?? null,
      refacciones: refaccionesByServicioId.get(servicio.id) ?? [],
      evidencias: evidenciasByServicioId.get(servicio.id) ?? [],
    })),
  )
}

async function prepareWeeklyBundlesForWorker(
  input: WeeklyReportExportInput,
  options?: BuildWeeklyReportOptions,
): Promise<ServiceEvidenceExportBundle[]> {
  emitWeeklyReportProgress(
    options,
    6,
    'Generando reporte semanal',
    'Consultando servicios cerrados de la semana...',
  )
  await yieldToBrowser(options?.signal)

  const fetchedBundles = await fetchWeeklyBundles(input, options?.signal)
  const bundles = filterBundlesByWeeklyReportMode(fetchedBundles, getWeeklyReportMode(input))
  if (bundles.length === 0) {
    throw new Error(buildNoWeeklyServicesMessage(input))
  }

  const totalEvidencias = bundles.reduce((total, bundle) => total + bundle.evidencias.length, 0)
  if (totalEvidencias === 0) {
    emitWeeklyReportProgress(
      options,
      16,
      'Generando reporte semanal',
      `${bundles.length} servicio(s) listos para exportación.`,
      0,
      bundles.length,
    )
    return bundles
  }

  emitWeeklyReportProgress(
    options,
    10,
    'Preparando evidencias',
    `${totalEvidencias} evidencia(s) listas para descarga segura.`,
    0,
    bundles.length,
  )

  return bundles
}

function fillWeeklyCaratula(
  files: Record<string, Uint8Array>,
  normalizedServices: NormalizedReportService[],
  semana: string,
  fechaInicio: string,
  fechaFin: string,
  lookups: TemplateLookups,
) {
  const document = getWorksheetDocument(files, 'xl/worksheets/sheet1.xml')
  const sheetData = getSheetData(document)

  const provider = normalizedServices[0]?.provider ?? lookups.proveedorDefault
  const gz = normalizedServices[0]?.gz ?? lookups.gzDefault
  const startDate = toExcelDateSerial(fechaInicio)
  const endDate = toExcelDateSerial(fechaFin)

  const row15 = getRow(sheetData, 15)
  const row16 = getRow(sheetData, 16)
  const row17 = getRow(sheetData, 17)
  const row20 = getRow(sheetData, 20)

  if (!row15 || !row16 || !row17 || !row20) {
    throw new Error('La carátula del reporte semanal no tiene la estructura esperada.')
  }

  setNumber(document, row15, 'D', provider)
  setInlineString(document, row16, 'D', gz)
  setInlineString(document, row17, 'D', semana)
  setNumber(document, row20, 'C', startDate)
  setNumber(document, row20, 'D', endDate)

  saveWorksheetDocument(files, 'xl/worksheets/sheet1.xml', document)
}

function fillWeeklyRegistroOrdenes(
  files: Record<string, Uint8Array>,
  normalizedServices: NormalizedReportService[],
) {
  const sheetPath = 'xl/worksheets/sheet2.xml'
  const document = getWorksheetDocument(files, sheetPath)
  const sheetData = getSheetData(document)
  const templateRow = getRowTemplate(sheetData, 2)

  const rows = buildClonedRows(
    templateRow,
    Math.max(1, normalizedServices.length),
    2,
    (row, index) => {
      const data = normalizedServices[index]

      if (!data) {
        setInlineString(document, row, 'E', '')
        setNumber(document, row, 'H', null)
        setNumber(document, row, 'I', null)
        setInlineString(document, row, 'J', '')
        setInlineString(document, row, 'K', '')
        setInlineString(document, row, 'L', '')
        setNumber(document, row, 'M', null)
        setNumber(document, row, 'N', null)
        setInlineString(document, row, 'Q', '')
        return
      }

      setInlineString(document, row, 'E', data.reportServiceType)
      setNumber(document, row, 'H', data.cierre?.aviso ?? data.servicio.aviso ?? null)
      setNumber(document, row, 'I', data.servicio.orden ?? null)
      setInlineString(document, row, 'J', data.servicio.cliente?.nombre ?? '')
      setInlineString(document, row, 'K', data.equipmentType)
      setInlineString(document, row, 'L', data.servicio.maquina?.serie ?? '')
      setNumber(document, row, 'M', data.fechaCierreExcel)
      setNumber(document, row, 'N', data.costoServicio)
      setInlineString(document, row, 'Q', data.comentario)
    },
  )

  replaceRowsFrom(sheetData, 2, rows)
  setWorksheetDimension(document, `A1:Q${rows[rows.length - 1]?.getAttribute('r') ?? '2'}`)
  saveWorksheetDocument(files, sheetPath, document)
  setTableReference(files, 'xl/tables/table1.xml', `A1:Q${Math.max(2, normalizedServices.length + 1)}`)
}

function fillWeeklyRegistroRefacciones(
  files: Record<string, Uint8Array>,
  normalizedServices: NormalizedReportService[],
) {
  const rowsData = normalizedServices.flatMap((service) =>
    service.refacciones.map((row) => ({
      service,
      row,
    })),
  )

  const sheetPath = 'xl/worksheets/sheet3.xml'
  const document = getWorksheetDocument(files, sheetPath)
  const sheetData = getSheetData(document)
  const templateRow = getRowTemplate(sheetData, 2)

  const rows = buildClonedRows(
    templateRow,
    Math.max(1, rowsData.length),
    2,
    (row, index) => {
      const data = rowsData[index]

      if (!data) {
        setNumber(document, row, 'B', null)
        setInlineString(document, row, 'C', '')
        setInlineString(document, row, 'F', '')
        setNumber(document, row, 'G', null)
        setNumber(document, row, 'H', null)
        return
      }

      setNumber(document, row, 'B', data.service.servicio.orden ?? null)
      setInlineString(document, row, 'C', data.service.refaccionesReportType)
      setInlineString(document, row, 'F', data.row.nombre_refaccion)
      setNumber(document, row, 'G', data.row.cantidad)
      setNumber(document, row, 'H', data.row.precio_unitario)
    },
  )

  replaceRowsFrom(sheetData, 2, rows)
  setWorksheetDimension(document, `A1:I${rows[rows.length - 1]?.getAttribute('r') ?? '2'}`)
  saveWorksheetDocument(files, sheetPath, document)
  setTableReference(files, 'xl/tables/table2.xml', `A1:I${Math.max(2, rowsData.length + 1)}`)
}

function buildWeeklySummaryRows(normalizedServices: NormalizedReportService[], semana: string): SummaryRow[] {
  const serviceSummaryMap = new Map<string, SummaryRow>()
  const refaccionesSummaryMap = new Map<string, SummaryRow>()

  for (const row of normalizedServices) {
    const serviceKey = [
      row.provider,
      row.gz,
      semana,
      row.reportServiceType,
      row.pep,
      row.pepNombre,
    ].join('|')

    const existingService = serviceSummaryMap.get(serviceKey)
    if (existingService) {
      existingService.total += row.costoServicio
    } else {
      serviceSummaryMap.set(serviceKey, {
        kind: 'servicio',
        provider: row.provider,
        gz: row.gz,
        periodo: semana,
        tipoServicio: row.reportServiceType,
        pep: row.pep,
        nombrePep: row.pepNombre,
        total: row.costoServicio,
      })
    }

    if (row.costoRefacciones <= 0) {
      continue
    }

    const refaccionesKey = [
      row.provider,
      row.gz,
      semana,
      row.refaccionesPep,
      row.refaccionesPepNombre,
      row.refaccionesReportType,
    ].join('|')

    const existingRefacciones = refaccionesSummaryMap.get(refaccionesKey)
    if (existingRefacciones) {
      existingRefacciones.total += row.costoRefacciones
    } else {
      refaccionesSummaryMap.set(refaccionesKey, {
        kind: 'refaccion',
        provider: row.provider,
        gz: row.gz,
        periodo: semana,
        tipoServicio: row.refaccionesReportType,
        pep: row.refaccionesPep,
        nombrePep: row.refaccionesPepNombre,
        total: row.costoRefacciones,
      })
    }
  }

  return [
    ...serviceSummaryMap.values(),
    ...refaccionesSummaryMap.values(),
  ].sort((left, right) => {
    if (left.provider !== right.provider) return left.provider - right.provider

    const byGz = left.gz.localeCompare(right.gz)
    if (byGz !== 0) return byGz

    const byPeriodo = left.periodo.localeCompare(right.periodo)
    if (byPeriodo !== 0) return byPeriodo

    if (left.kind !== right.kind) {
      return left.kind === 'servicio' ? -1 : 1
    }

    const byType = left.tipoServicio.localeCompare(right.tipoServicio)
    if (byType !== 0) return byType

    return left.pep.localeCompare(right.pep)
  })
}

function buildWeeklySummaryDisplayRows(summaryRows: SummaryRow[]): SummaryDisplayRow[] {
  return summaryRows.map((row, index) => {
    const previous = summaryRows[index - 1]
    const samePeriodo = previous?.provider === row.provider
      && previous?.gz === row.gz
      && previous?.periodo === row.periodo
    const sameTipo = samePeriodo && previous?.tipoServicio === row.tipoServicio
    const samePep = sameTipo && previous?.pep === row.pep
    const samePepName = samePep && previous?.nombrePep === row.nombrePep

    return {
      provider: row.provider,
      gz: row.gz,
      periodo: row.periodo,
      tipoServicio: sameTipo ? '' : row.tipoServicio,
      pep: samePep ? '' : row.pep,
      nombrePep: samePepName ? '' : row.nombrePep,
      total: row.total,
    }
  })
}

function fillWeeklyResumenPago(
  files: Record<string, Uint8Array>,
  summaryRows: SummaryRow[],
) {
  const styles = ensureWeeklyResumenStyles(files)
  const sheetPath = 'xl/worksheets/sheet4.xml'
  const document = getWorksheetDocument(files, sheetPath)
  const sheetData = getSheetData(document)
  const displayRows = buildWeeklySummaryDisplayRows(summaryRows)
  let runningTotal = 0
  const dataRowCount = Math.max(1, displayRows.length)
  const rows: Element[] = []

  const filterRow = createRow(document, 1)
  setInlineString(document, filterRow, 'A', 'Aviso', styles.pageLabel)
  setInlineString(document, filterRow, 'B', '(Todas)', styles.pageValue)
  rows.push(filterRow)

  const topBarRow = createRow(document, 3)
  for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const) {
    setInlineString(document, topBarRow, column, column === 'A' ? 'Sum of Total' : '', styles.topBar)
  }
  rows.push(topBarRow)

  const headerRow = createRow(document, 4)
  setInlineString(document, headerRow, 'A', 'Proveedor', styles.header)
  setInlineString(document, headerRow, 'B', 'GZ', styles.header)
  setInlineString(document, headerRow, 'C', 'Periodo', styles.header)
  setInlineString(document, headerRow, 'D', 'Tipo de Servicio', styles.header)
  setInlineString(document, headerRow, 'E', 'PEP', styles.header)
  setInlineString(document, headerRow, 'F', 'Nombre el PEP', styles.header)
  setInlineString(document, headerRow, 'G', 'Total', styles.header)
  rows.push(headerRow)

  for (let index = 0; index < dataRowCount; index += 1) {
    const data = displayRows[index]
    const isAlt = index % 2 === 0
    const textStyle = isAlt ? styles.bodyTextAlt : styles.bodyText
    const numberStyle = isAlt ? styles.bodyNumberAlt : styles.bodyNumber
    const currencyStyle = isAlt ? styles.bodyCurrencyAlt : styles.bodyCurrency
    const rowNumber = 5 + index
    const dataRow = createRow(document, rowNumber)

    if (!data) {
      setNumber(document, dataRow, 'A', null, numberStyle)
      setInlineString(document, dataRow, 'B', '', textStyle)
      setInlineString(document, dataRow, 'C', '', textStyle)
      setInlineString(document, dataRow, 'D', '', textStyle)
      setInlineString(document, dataRow, 'E', '', textStyle)
      setInlineString(document, dataRow, 'F', '', textStyle)
      setNumber(document, dataRow, 'G', null, currencyStyle)
      rows.push(dataRow)
      continue
    }

    runningTotal += data.total
    setNumber(document, dataRow, 'A', data.provider, numberStyle)
    setInlineString(document, dataRow, 'B', data.gz, textStyle)
    setInlineString(document, dataRow, 'C', data.periodo, textStyle)
    setInlineString(document, dataRow, 'D', data.tipoServicio, textStyle)
    setInlineString(document, dataRow, 'E', data.pep, textStyle)
    setInlineString(document, dataRow, 'F', data.nombrePep, textStyle)
    setNumber(document, dataRow, 'G', Number(data.total.toFixed(2)), currencyStyle)
    rows.push(dataRow)
  }

  const totalRowNumber = 5 + dataRowCount
  const totalRow = createRow(document, totalRowNumber)
  setInlineString(document, totalRow, 'A', 'Total general', styles.totalLabel)
  setInlineString(document, totalRow, 'B', '', styles.totalLabel)
  setInlineString(document, totalRow, 'C', '', styles.totalLabel)
  setInlineString(document, totalRow, 'D', '', styles.totalLabel)
  setInlineString(document, totalRow, 'E', '', styles.totalLabel)
  setInlineString(document, totalRow, 'F', '', styles.totalLabel)
  setNumber(document, totalRow, 'G', Number(runningTotal.toFixed(2)), styles.totalCurrency)
  rows.push(totalRow)

  replaceRowsFrom(sheetData, 1, rows)
  setWorksheetAutoFilter(document, `A4:G${4 + dataRowCount}`)
  setWorksheetDataValidationList(document, 'B1', ['(Todas)'])
  setWorksheetDimension(document, `A1:G${totalRowNumber}`)
  saveWorksheetDocument(files, sheetPath, document)
}

async function buildWeeklyWorkbookBytes(
  weeklyTemplateBuffer: ArrayBuffer,
  normalizedServices: NormalizedReportService[],
  input: WeeklyReportExportInput,
  lookups: TemplateLookups,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal)
  const files = UZIP.parse(weeklyTemplateBuffer.slice(0))
  const summaryRows = buildWeeklySummaryRows(normalizedServices, input.semana)

  removeCalcChain(files)
  setCalcPrForFullRecalc(files)
  await yieldToBrowser(signal)

  fillWeeklyCaratula(files, normalizedServices, input.semana, input.fechaInicio, input.fechaFin, lookups)
  await yieldToBrowser(signal)
  fillWeeklyRegistroOrdenes(files, normalizedServices)
  await yieldToBrowser(signal)
  fillWeeklyRegistroRefacciones(files, normalizedServices)
  await yieldToBrowser(signal)
  fillWeeklyResumenPago(files, summaryRows)
  removeWeeklyPivotArtifacts(files)
  await yieldToBrowser(signal)

  return toUint8Array(UZIP.encode(files))
}

function buildWeeklyWorkbookFilename(input: WeeklyReportExportInput): string {
  const mode = getWeeklyReportMode(input)
  const suffix = mode === 'todos' ? '' : `_${getWeeklyReportModeConfig(mode).slug}`
  return `${sanitizeFilenamePart(input.semana)}${suffix}_ReporteSemanal.xlsx`
}

function buildWeeklyZipFilename(input: WeeklyReportExportInput): string {
  const mode = getWeeklyReportMode(input)
  const suffix = mode === 'todos' ? '' : `_${getWeeklyReportModeConfig(mode).slug}`
  return `${sanitizeFilenamePart(input.semana)}${suffix}_ReporteSemanal.zip`
}

function buildWeeklyCombinedZipFilename(semana: string): string {
  return `${sanitizeFilenamePart(semana)}_ReportesSemanales.zip`
}

function buildEvidenceWorkbookFilename(bundle: ServiceEvidenceExportBundle): string {
  const orden = bundle.servicio.orden != null ? sanitizeFilenamePart(bundle.servicio.orden) : `servicio-${bundle.servicio.id}`
  const tipoServicio = sanitizeFilenamePart(bundle.servicio.tipo_servicio)
  return `${orden}_${tipoServicio}.xlsx`
}

function downloadBlob(filename: string, blob: Blob) {
  const fileUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = fileUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1_000)
}

function toBlobBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function getOptimizedImageDimensions(
  width: number,
  height: number,
  maxLongSidePx: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const longSide = Math.max(safeWidth, safeHeight)

  if (longSide <= maxLongSidePx) {
    return { width: safeWidth, height: safeHeight }
  }

  const scale = maxLongSidePx / longSide
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

function getImageExportAttempts(profile: ImageExportProfile): Array<{ maxLongSidePx: number; quality: number }> {
  return [
    {
      maxLongSidePx: profile.maxLongSidePx,
      quality: profile.initialQuality,
    },
    {
      maxLongSidePx: Math.round(profile.maxLongSidePx * 0.88),
      quality: Math.max(profile.minQuality, profile.initialQuality - 0.1),
    },
    {
      maxLongSidePx: Math.round(profile.maxLongSidePx * 0.78),
      quality: profile.minQuality,
    },
  ]
}

async function canvasBlobToEmbeddedImage(blob: Blob): Promise<EmbeddedImage> {
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    extension: 'jpeg',
    mimeType: 'image/jpeg',
  }
}

function getImageExtensionFromMimeType(mimeType: string | null | undefined): EmbeddedImage['extension'] | null {
  const normalized = String(mimeType ?? '').toLowerCase().split(';')[0].trim()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpeg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/gif') return 'gif'
  return null
}

function getImageExtensionFromFilename(filename: string | null | undefined): EmbeddedImage['extension'] | null {
  const normalized = String(filename ?? '').toLowerCase()
  if (/\.(jpe?g)$/i.test(normalized)) return 'jpeg'
  if (/\.png$/i.test(normalized)) return 'png'
  if (/\.gif$/i.test(normalized)) return 'gif'
  return null
}

function getImageMimeTypeFromFilename(filename: string | null | undefined): string | null {
  const normalized = String(filename ?? '').toLowerCase()
  if (/\.(jpe?g)$/i.test(normalized)) return 'image/jpeg'
  if (/\.png$/i.test(normalized)) return 'image/png'
  if (/\.gif$/i.test(normalized)) return 'image/gif'
  if (/\.webp$/i.test(normalized)) return 'image/webp'
  if (/\.bmp$/i.test(normalized)) return 'image/bmp'
  if (/\.svg$/i.test(normalized)) return 'image/svg+xml'
  if (/\.tiff?$/i.test(normalized)) return 'image/tiff'
  if (/\.hei[cf]$/i.test(normalized)) return 'image/heic'
  return null
}

function getDecodableImageBlob(blob: Blob, filename?: string): Blob {
  const normalizedType = blob.type.toLowerCase().split(';')[0].trim()
  if (normalizedType.startsWith('image/')) return blob

  const inferredType = getImageMimeTypeFromFilename(filename)
  if (!inferredType) return blob

  return new Blob([blob], { type: inferredType })
}

async function originalBlobToEmbeddedImage(
  blob: Blob,
  filename?: string,
): Promise<EmbeddedImage | null> {
  const extension = getImageExtensionFromMimeType(blob.type)
    ?? getImageExtensionFromFilename(filename)
  if (!extension) return null

  const mimeType = extension === 'jpeg'
    ? 'image/jpeg'
    : extension === 'png' ? 'image/png' : 'image/gif'

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    extension,
    mimeType,
  }
}

async function renderBitmapToJpeg(
  bitmap: ImageBitmap,
  maxLongSidePx: number,
  quality: number,
): Promise<EmbeddedImage> {
  const dimensions = getOptimizedImageDimensions(bitmap.width, bitmap.height, maxLongSidePx)
  const canvas = new OffscreenCanvas(dimensions.width, dimensions.height)
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('No se pudo preparar el canvas para optimizar la imagen.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, dimensions.width, dimensions.height)
  context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)

  return canvasBlobToEmbeddedImage(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
}

async function renderHtmlImageToJpeg(
  image: HTMLImageElement,
  maxLongSidePx: number,
  quality: number,
): Promise<EmbeddedImage> {
  const dimensions = getOptimizedImageDimensions(image.naturalWidth, image.naturalHeight, maxLongSidePx)
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('No se pudo preparar el canvas para optimizar la imagen.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, dimensions.width, dimensions.height)
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height)

  const convertedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (!value) {
          reject(new Error('No se pudo exportar la imagen optimizada.'))
          return
        }
        resolve(value)
      },
      'image/jpeg',
      quality,
    )
  })

  return canvasBlobToEmbeddedImage(convertedBlob)
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    throw new Error('Este navegador no soporta lectura de imágenes para exportar a Excel.')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('No se pudo leer la imagen para exportar a Excel.'))
    }
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para exportar a Excel.'))
    reader.readAsDataURL(blob)
  })
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const instance = new Image()
    instance.onload = () => resolve(instance)
    instance.onerror = () => reject(new Error('No se pudo decodificar la imagen para Excel.'))
    instance.src = src
  })
}

async function optimizeWithBitmap(
  blob: Blob,
  profile: ImageExportProfile,
): Promise<EmbeddedImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    let smallestCandidate: EmbeddedImage | null = null

    for (const attempt of getImageExportAttempts(profile)) {
      const candidate = await renderBitmapToJpeg(bitmap, attempt.maxLongSidePx, attempt.quality)
      if (!smallestCandidate || candidate.bytes.byteLength < smallestCandidate.bytes.byteLength) {
        smallestCandidate = candidate
      }

      if (candidate.bytes.byteLength <= profile.softLimitBytes) {
        return candidate
      }
    }

    return smallestCandidate!
  } finally {
    bitmap.close?.()
  }
}

async function optimizeWithHtmlImage(
  blob: Blob,
  profile: ImageExportProfile,
  filename?: string,
): Promise<EmbeddedImage> {
  const imageBlob = getDecodableImageBlob(blob, filename)
  const objectUrl = URL.createObjectURL(imageBlob)
  try {
    let image: HTMLImageElement
    try {
      image = await loadHtmlImage(objectUrl)
    } catch {
      image = await loadHtmlImage(await blobToDataUrl(imageBlob))
    }

    let smallestCandidate: EmbeddedImage | null = null

    for (const attempt of getImageExportAttempts(profile)) {
      const candidate = await renderHtmlImageToJpeg(image, attempt.maxLongSidePx, attempt.quality)
      if (!smallestCandidate || candidate.bytes.byteLength < smallestCandidate.bytes.byteLength) {
        smallestCandidate = candidate
      }

      if (candidate.bytes.byteLength <= profile.softLimitBytes) {
        return candidate
      }
    }

    return smallestCandidate!
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function toEmbeddedImage(
  blob: Blob,
  profile: ImageExportProfile,
  filename?: string,
): Promise<EmbeddedImage> {
  const imageBlob = getDecodableImageBlob(blob, filename)
  // Convertir a JPEG reescalado baja mucho el XLSX y elimina metadata pesada de fotos de celular.
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      return await optimizeWithBitmap(imageBlob, profile)
    } catch (error) {
      if (typeof document === 'undefined' || typeof Image === 'undefined') {
        const original = await originalBlobToEmbeddedImage(imageBlob, filename)
        if (original) return original
        throw error
      }
    }
  }

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    const original = await originalBlobToEmbeddedImage(imageBlob, filename)
    if (original) return original
    throw new Error('Este navegador no soporta la conversión requerida para exportar la imagen.')
  }

  try {
    return await optimizeWithHtmlImage(imageBlob, profile, filename)
  } catch (error) {
    const original = await originalBlobToEmbeddedImage(imageBlob, filename)
    if (original) return original
    throw error
  }
}

async function downloadEvidenceAsset(
  evidencia: Evidencia,
  profile: ImageExportProfile,
  signal?: AbortSignal,
): Promise<EmbeddedImage> {
  const blob = await downloadEvidenciaBlob(evidencia.r2_key, { signal })
  return toEmbeddedImage(blob, profile, evidencia.filename)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      throwIfAborted(signal)
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

async function buildEvidenceAssets(
  bundle: ServiceEvidenceExportBundle,
  signal?: AbortSignal,
) {
  const ordenServicio = bundle.evidencias
    .filter((evidencia) => isOrdenServicioFilename(evidencia.filename))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null

  const fotos = bundle.evidencias
    .filter((evidencia) => !isOrdenServicioFilename(evidencia.filename))
    .sort((left, right) => {
      if (left.orden !== right.orden) return left.orden - right.orden
      return left.created_at.localeCompare(right.created_at)
    })

  const orderAsset = ordenServicio
    ? await downloadEvidenceAsset(ordenServicio, ORDER_EXPORT_IMAGE_PROFILE, signal)
      .then((image) => ({ image, message: null as string | null }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }

        return {
          image: null,
          message: error instanceof Error ? error.message : 'No se pudo descargar la orden de servicio.',
        }
      })
    : {
        image: null,
        message: 'No hay orden de servicio registrada para este servicio.',
      }

  const photoAssets = await mapWithConcurrency(fotos, 4, signal, async (evidencia) => {
    try {
      throwIfAborted(signal)
      return {
        image: await downloadEvidenceAsset(evidencia, PHOTO_EXPORT_IMAGE_PROFILE, signal),
        message: null as string | null,
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }

      return {
        image: null,
        message: error instanceof Error ? error.message : 'No se pudo descargar la evidencia.',
      }
    }
  })

  const slots: WorksheetImageSlot[] = photoAssets.map((asset, index) => {
    const slotTemplate = PHOTO_SLOTS[index % PHOTO_SLOTS.length]
    return {
      label: index + 1,
      contentCell: slotTemplate.contentCell,
      from: slotTemplate.from,
      to: slotTemplate.to,
      image: asset.image,
      message: asset.image ? null : asset.message ?? 'No se pudo descargar la evidencia.',
    }
  })

  return {
    orderAsset,
    photoSlots: slots,
  }
}

async function getExcelWorkbookConstructor(): Promise<ExcelWorkbookConstructor> {
  if (!excelJsWorkbookConstructorPromise) {
    excelJsWorkbookConstructorPromise = import('exceljs').then((module) => {
      const namespace = module as unknown as {
        default?: { Workbook?: ExcelWorkbookConstructor }
        Workbook?: ExcelWorkbookConstructor
      }
      const WorkbookCtor = namespace.default?.Workbook ?? namespace.Workbook

      if (!WorkbookCtor) {
        throw new Error('No se pudo inicializar la librería de Excel para exportar evidencias.')
      }

      return WorkbookCtor
    })
  }

  return excelJsWorkbookConstructorPromise
}

function cloneExcelSerializable<T>(value: T): T {
  if (value === null || value === undefined) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function getEvidenceWorksheet(workbook: ExcelWorkbook, name: string): ExcelWorksheet {
  const worksheet = workbook.getWorksheet(name)
  if (!worksheet) {
    throw new Error(`La plantilla de evidencias no contiene la hoja "${name}".`)
  }

  return worksheet
}

function cloneWorksheetTemplate(
  workbook: ExcelWorkbook,
  source: ExcelWorksheet,
  name: string,
): ExcelWorksheet {
  const target = workbook.addWorksheet(name)

  Object.assign(target.properties, cloneExcelSerializable(source.properties))
  Object.assign(target.pageSetup, cloneExcelSerializable(source.pageSetup))
  Object.assign(target.headerFooter, cloneExcelSerializable(source.headerFooter))
  target.views = cloneExcelSerializable(source.views ?? [])

  if (source.autoFilter) {
    target.autoFilter = cloneExcelSerializable(source.autoFilter)
  }

  target.state = source.state

  for (let columnIndex = 1; columnIndex <= source.columnCount; columnIndex += 1) {
    const sourceColumn = source.getColumn(columnIndex)
    const targetColumn = target.getColumn(columnIndex)
    targetColumn.width = sourceColumn.width
    targetColumn.hidden = sourceColumn.hidden
    targetColumn.outlineLevel = sourceColumn.outlineLevel
    targetColumn.style = cloneExcelSerializable(sourceColumn.style)
  }

  for (const merge of source.model.merges ?? []) {
    target.mergeCells(merge)
  }

  for (let rowNumber = 1; rowNumber <= source.rowCount; rowNumber += 1) {
    const sourceRow = source.getRow(rowNumber)
    const targetRow = target.getRow(rowNumber)
    targetRow.height = sourceRow.height
    targetRow.hidden = sourceRow.hidden
    targetRow.outlineLevel = sourceRow.outlineLevel

    for (let columnIndex = 1; columnIndex <= source.columnCount; columnIndex += 1) {
      const sourceCell = sourceRow.getCell(columnIndex)

      if (sourceCell.isMerged && sourceCell.master.address !== sourceCell.address) {
        continue
      }

      const targetCell = targetRow.getCell(columnIndex)
      targetCell.value = cloneExcelSerializable(sourceCell.value)
      targetCell.style = cloneExcelSerializable(sourceCell.style)

      if (sourceCell.note) {
        targetCell.note = cloneExcelSerializable(sourceCell.note)
      }

      if (sourceCell.dataValidation && Object.keys(sourceCell.dataValidation).length > 0) {
        targetCell.dataValidation = cloneExcelSerializable(sourceCell.dataValidation)
      }
    }
  }

  return target
}

function buildPhotoWorksheetPages(
  workbook: ExcelWorkbook,
  slots: WorksheetImageSlot[],
): Array<{ worksheet: ExcelWorksheet; slots: WorksheetImageSlot[] }> {
  const basePage = getEvidenceWorksheet(workbook, 'Evidencia fotográfica')
  const additionalPageTemplate = getEvidenceWorksheet(workbook, 'Evidencia fotográfica (ad)')

  const pages: Array<{ worksheet: ExcelWorksheet; slots: WorksheetImageSlot[] }> = [
    { worksheet: basePage, slots: slots.slice(0, 4) },
    { worksheet: additionalPageTemplate, slots: slots.slice(4, 8) },
  ]

  const extraGroups = Math.ceil(Math.max(0, slots.length - 8) / 4)
  for (let index = 0; index < extraGroups; index += 1) {
    const groupStart = 8 + (index * 4)
    pages.push({
      worksheet: cloneWorksheetTemplate(
        workbook,
        additionalPageTemplate,
        `Evidencia fotográfica (ad ${index + 2})`,
      ),
      slots: slots.slice(groupStart, groupStart + 4),
    })
  }

  return pages
}

function toExcelJsImage(image: EmbeddedImage): { base64: string; extension: EmbeddedImage['extension'] } {
  return {
    base64: `data:${image.mimeType};base64,${uint8ArrayToBase64(image.bytes)}`,
    extension: image.extension,
  }
}

async function buildEvidenceWorkbookBytes(
  evidenceTemplateBuffer: ArrayBuffer,
  bundle: ServiceEvidenceExportBundle,
  orderImage: EmbeddedImage | null,
  orderMessage: string | null,
  photoSlots: WorksheetImageSlot[],
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal)
  const WorkbookCtor = await getExcelWorkbookConstructor()
  const workbook = new WorkbookCtor()

  await workbook.xlsx.load(evidenceTemplateBuffer.slice(0))
  workbook.calcProperties.fullCalcOnLoad = true
  await yieldToBrowser(signal)

  const caratulaSheet = getEvidenceWorksheet(workbook, 'Carátula')
  caratulaSheet.getCell('B7').value = bundle.servicio.orden ?? bundle.servicio.id

  const lineItems = buildEvidenceLineItems(bundle)
  const componentRows = Array.from({ length: 41 }, (_, index) => 15 + index)
  for (let index = 0; index < componentRows.length; index += 1) {
    const rowNumber = componentRows[index]
    const lineItem = lineItems[index]

    caratulaSheet.getCell(`B${rowNumber}`).value = lineItem?.nombre ?? null
    caratulaSheet.getCell(`E${rowNumber}`).value = lineItem?.cantidad ?? null
    caratulaSheet.getCell(`F${rowNumber}`).value = lineItem?.precioUnitario ?? null
    caratulaSheet.getCell(`H${rowNumber}`).value = {
      formula: `IF(B${rowNumber}="","",F${rowNumber}*E${rowNumber})`,
      result: lineItem?.subtotal,
    }
  }

  caratulaSheet.getCell('G11').value = {
    formula: 'SUM(H15:I64)',
    result: Number(bundle.servicio.total ?? 0),
  }

  await yieldToBrowser(signal)

  const orderSheet = getEvidenceWorksheet(workbook, 'Orden de servicio')
  orderSheet.getCell('A3').value = orderMessage ?? ''

  if (orderImage) {
    const orderImageId = workbook.addImage(toExcelJsImage(orderImage))
    orderSheet.addImage(orderImageId, toExcelRange({ col: 0, row: 2 }, { col: 9, row: 49 }))
  }

  await yieldToBrowser(signal)

  const pages = buildPhotoWorksheetPages(workbook, photoSlots)
  for (const page of pages) {
    PHOTO_SLOTS.forEach((slotTemplate, index) => {
      const slot = page.slots[index]
      page.worksheet.getCell(slotTemplate.labelCell).value = slot ? slot.label : null
      page.worksheet.getCell(slotTemplate.contentCell).value = slot?.message ?? null

      if (!slot?.image) {
        return
      }

      const imageId = workbook.addImage(toExcelJsImage(slot.image))
      page.worksheet.addImage(imageId, toExcelRange(slot.from, slot.to))
    })

    await yieldToBrowser(signal)
  }

  await yieldToBrowser(signal)
  return toUint8Array(await workbook.xlsx.writeBuffer())
}

export async function buildServiceEvidenceWorkbook(
  bundle: ServiceEvidenceExportBundle,
  options?: BuildServiceEvidenceWorkbookOptions,
): Promise<BuildBinaryResult> {
  throwIfAborted(options?.signal)

  const evidenceTemplateBuffer = options?.templateBuffer ?? await loadTemplateArrayBuffer(EVIDENCE_TEMPLATE_URL)
  const { orderAsset, photoSlots } = await buildEvidenceAssets(bundle, options?.signal)
  await yieldToBrowser(options?.signal)
  const bytes = await buildEvidenceWorkbookBytes(
    evidenceTemplateBuffer,
    bundle,
    orderAsset.image,
    orderAsset.message,
    photoSlots,
    options?.signal,
  )

  return {
    blob: new Blob([toBlobBuffer(bytes)], { type: XLSX_MIME }),
    filename: buildEvidenceWorkbookFilename(bundle),
  }
}

export async function exportServiceEvidenceWorkbook(
  bundle: ServiceEvidenceExportBundle,
): Promise<{ filename: string }> {
  const result = await buildServiceEvidenceWorkbook(bundle)
  downloadBlob(result.filename, result.blob)
  return { filename: result.filename }
}

export async function buildWeeklyReportBundleFromBundles(
  input: WeeklyReportExportInput,
  bundles: ServiceEvidenceExportBundle[],
  options?: BuildWeeklyReportOptions,
): Promise<BuildBinaryResult & WeeklyReportExportResult> {
  const { entries, totalServicios } = await buildWeeklyReportEntriesFromBundles(input, bundles, options)

  const zipBlob = new Blob([toBlobBuffer(toUint8Array(UZIP.encode(entries)))], { type: ZIP_MIME })
  emitWeeklyReportProgress(
    options,
    98,
    'Empaquetando reporte semanal',
    'ZIP listo. Preparando descarga...',
    totalServicios,
    totalServicios,
  )

  return {
    blob: zipBlob,
    filename: buildWeeklyZipFilename(input),
    totalServicios,
  }
}

async function buildWeeklyReportEntriesFromBundles(
  input: WeeklyReportExportInput,
  bundles: ServiceEvidenceExportBundle[],
  options?: BuildWeeklyReportOptions,
): Promise<{ entries: Record<string, Uint8Array>; totalServicios: number }> {
  emitWeeklyReportProgress(
    options,
    18,
    'Generando reporte semanal',
    `${bundles.length} servicio(s) listos para exportación. Cargando plantillas base...`,
    0,
    bundles.length,
  )
  await yieldToBrowser(options?.signal)

  const [weeklyTemplateBuffer, evidenceTemplateBuffer] = await Promise.all([
    loadTemplateArrayBuffer(WEEKLY_TEMPLATE_URL),
    loadTemplateArrayBuffer(EVIDENCE_TEMPLATE_URL),
  ])
  throwIfAborted(options?.signal)

  if (bundles.length === 0) {
    throw new Error('No hay servicios cerrados en la semana seleccionada para exportar.')
  }

  emitWeeklyReportProgress(
    options,
    18,
    'Generando reporte semanal',
    `${bundles.length} servicio(s) listos para exportación.`,
    0,
    bundles.length,
  )
  await yieldToBrowser(options?.signal)

  const lookups = await loadTemplateLookups(weeklyTemplateBuffer)
  throwIfAborted(options?.signal)
  emitWeeklyReportProgress(
    options,
    28,
    'Generando reporte semanal',
    'Aplicando catálogo de tipos, PEP y resumen principal...',
    0,
    bundles.length,
  )
  await yieldToBrowser(options?.signal)

  const normalizedServices = bundles.map((bundle) => normalizeReportService(bundle, lookups))
  await yieldToBrowser(options?.signal)

  const weeklyWorkbookBytes = await buildWeeklyWorkbookBytes(
    weeklyTemplateBuffer,
    normalizedServices,
    input,
    lookups,
    options?.signal,
  )
  const weeklyWorkbookFilename = buildWeeklyWorkbookFilename(input)
  emitWeeklyReportProgress(
    options,
    40,
    'Generando reporte semanal',
    'Concentrado semanal listo.',
    0,
    bundles.length,
  )
  await yieldToBrowser(options?.signal)

  const workbookEntries: Record<string, Uint8Array> = {
    [weeklyWorkbookFilename]: weeklyWorkbookBytes,
  }

  for (let index = 0; index < bundles.length; index += 1) {
    const bundle = bundles[index]
    const progressStart = 42 + ((index / bundles.length) * 48)
    const progressEnd = 42 + (((index + 1) / bundles.length) * 48)
    const serviceReference = bundle.servicio.orden ?? bundle.servicio.id

    emitWeeklyReportProgress(
      options,
      progressStart,
      `Generando evidencia para servicio #${serviceReference}`,
      `${index + 1} de ${bundles.length}`,
      index,
      bundles.length,
    )
    await yieldToBrowser(options?.signal)

    const serviceWorkbook = await buildServiceEvidenceWorkbook(bundle, {
      signal: options?.signal,
      templateBuffer: evidenceTemplateBuffer,
    })
    workbookEntries[serviceWorkbook.filename] = toUint8Array(await serviceWorkbook.blob.arrayBuffer())

    emitWeeklyReportProgress(
      options,
      progressEnd,
      `Generando evidencia para servicio #${serviceReference}`,
      `Servicio ${index + 1} de ${bundles.length} listo.`,
      index + 1,
      bundles.length,
    )
    await yieldToBrowser(options?.signal)
  }

  emitWeeklyReportProgress(
    options,
    94,
    'Empaquetando reporte semanal',
    'Comprimiendo ZIP final del reporte semanal...',
    bundles.length,
    bundles.length,
  )
  await yieldToBrowser(options?.signal)

  return {
    entries: workbookEntries,
    totalServicios: bundles.length,
  }
}

export async function buildWeeklyReportBundle(
  input: WeeklyReportExportInput,
  options?: BuildWeeklyReportOptions,
): Promise<BuildBinaryResult & WeeklyReportExportResult> {
  const bundles = await prepareWeeklyBundlesForWorker(input, options)
  if (getWeeklyReportMode(input) === 'ambos') {
    return exportCombinedWeeklyReports(input, bundles, options)
  }

  return buildWeeklyReportBundleFromBundles(input, bundles, options)
}

async function buildWeeklyReportBinary(
  input: WeeklyReportExportInput,
  bundles: ServiceEvidenceExportBundle[],
  options?: BuildWeeklyReportOptions,
): Promise<BuildBinaryResult & WeeklyReportExportResult> {
  if (canUseWeeklyReportWorker()) {
    try {
      return await buildWeeklyReportBundleInWorker(input, bundles, options)
    } catch (error) {
      if (!isWorkerDomApiUnavailableError(error)) {
        throw error
      }

      emitWeeklyReportProgress(
        options,
        20,
        'Generando reporte semanal',
        'Este navegador no permite procesar XML dentro del worker. Continuando en modo compatible...',
        0,
        bundles.length,
      )
      await yieldToBrowser(options?.signal)
    }
  }

  return buildWeeklyReportBundleFromBundles(input, bundles, options)
}

async function exportCombinedWeeklyReports(
  input: WeeklyReportExportInput,
  bundles: ServiceEvidenceExportBundle[],
  options?: BuildWeeklyReportOptions,
): Promise<BuildBinaryResult & WeeklyReportExportResult> {
  const reportEntries: Record<string, Uint8Array> = {}
  let totalServicios = 0

  const reportGroups: Array<{ mode: Exclude<WeeklyReportExportMode, 'todos' | 'ambos'>; bundles: ServiceEvidenceExportBundle[] }> = [
    {
      mode: 'instalaciones_retiros',
      bundles: filterBundlesByWeeklyReportMode(bundles, 'instalaciones_retiros'),
    },
    {
      mode: 'mantenimientos',
      bundles: filterBundlesByWeeklyReportMode(bundles, 'mantenimientos'),
    },
  ]

  if (reportGroups.every((group) => group.bundles.length === 0)) {
    throw new Error(buildNoWeeklyServicesMessage(input))
  }

  for (let index = 0; index < reportGroups.length; index += 1) {
    const group = reportGroups[index]
    if (group.bundles.length === 0) continue

    const scopedInput: WeeklyReportExportInput = {
      ...input,
      reportMode: group.mode,
    }
    const scopedOptions = withProgressRange(options, index === 0 ? 18 : 56, index === 0 ? 54 : 92)

    emitWeeklyReportProgress(
      scopedOptions,
      0,
      `Generando reporte de ${getWeeklyReportModeConfig(group.mode).label}`,
      `${group.bundles.length} servicio(s) incluidos.`,
      0,
      group.bundles.length,
    )

    const result = await buildWeeklyReportEntriesFromBundles(scopedInput, group.bundles, scopedOptions)
    const folderName = getWeeklyReportModeConfig(group.mode).slug

    for (const [filename, bytes] of Object.entries(result.entries)) {
      reportEntries[`${folderName}/${filename}`] = bytes
    }

    totalServicios += result.totalServicios
  }

  emitWeeklyReportProgress(
    options,
    94,
    'Empaquetando reportes semanales',
    'Comprimiendo ZIP con ambos reportes...',
    totalServicios,
    totalServicios,
  )
  await yieldToBrowser(options?.signal)

  const blob = new Blob([toBlobBuffer(toUint8Array(UZIP.encode(reportEntries)))], { type: ZIP_MIME })
  return {
    blob,
    filename: buildWeeklyCombinedZipFilename(input.semana),
    totalServicios,
  }
}

function canUseWeeklyReportWorker(): boolean {
  return false
}

function isWorkerDomApiUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message}`.toLowerCase()
  return text.includes('domparser')
    || text.includes('dom parser')
    || text.includes('xmlserializer')
}

function buildWeeklyReportBundleInWorker(
  input: WeeklyReportExportInput,
  bundles: ServiceEvidenceExportBundle[],
  options?: BuildWeeklyReportOptions,
): Promise<BuildBinaryResult & WeeklyReportExportResult> {
  throwIfAborted(options?.signal)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reportes-export.worker.ts', import.meta.url), { type: 'module' })
    let settled = false

    const cleanup = () => {
      options?.signal?.removeEventListener('abort', handleAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }

    const settleReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const handleAbort = () => {
      try {
        worker.postMessage({ type: 'cancel' })
      } catch {
        // El terminate de abajo es la cancelación definitiva.
      }
      settleReject(createAbortError())
    }

    options?.signal?.addEventListener('abort', handleAbort, { once: true })
    if (options?.signal?.aborted) {
      handleAbort()
      return
    }

    worker.onerror = (event) => {
      settleReject(new Error(event.message || 'No se pudo generar el reporte semanal.'))
    }

    worker.onmessage = (event: MessageEvent<WeeklyReportWorkerMessage>) => {
      const message = event.data

      if (message.type === 'progress') {
        options?.onProgress?.(message.progress)
        return
      }

      if (message.type === 'error') {
        const error = new Error(message.message)
        if (message.name) error.name = message.name
        settleReject(error)
        return
      }

      if (settled) return
      settled = true
      cleanup()
      resolve({
        blob: new Blob([message.buffer], { type: ZIP_MIME }),
        filename: message.filename,
        totalServicios: message.totalServicios,
      })
    }

    worker.postMessage({
      type: 'build',
      input,
      bundles,
    })
  })
}

export async function exportWeeklyReportBundle(
  input: WeeklyReportExportInput,
  options?: BuildWeeklyReportOptions,
): Promise<WeeklyReportExportResult> {
  const bundles = await prepareWeeklyBundlesForWorker(input, options)
  const result = getWeeklyReportMode(input) === 'ambos'
    ? await exportCombinedWeeklyReports(input, bundles, options)
    : await buildWeeklyReportBinary(input, bundles, options)

  throwIfAborted(options?.signal)
  emitWeeklyReportProgress(
    options,
    100,
    'Descarga lista',
    `Se generó ${result.filename}.`,
    result.totalServicios,
    result.totalServicios,
  )
  downloadBlob(result.filename, result.blob)
  return {
    filename: result.filename,
    totalServicios: result.totalServicios,
  }
}
