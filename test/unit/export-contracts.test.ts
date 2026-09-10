import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import UZIP from 'uzip'
import { buildCierresReportBuffer } from '@/lib/cierres-export'
import { buildWeeklyReportBundleFromBundles } from '@/lib/reportes-export'
import { buildCierre, buildMaquina, buildServicio, buildServicioRefaccion } from '../fixtures/domain'

const root = process.cwd()

// Estas pruebas descomprimen y reescriben la plantilla semanal completa (917 conceptos en
// CatPEP). Tardan bastante más que el límite de 5 s de vitest, y en CI corren además con
// instrumentación de cobertura, así que llevan su propio límite en vez de aflojar el
// global —que ocultaría cuelgues reales en el resto de la suite—.
const HEAVY_WORKBOOK_TIMEOUT_MS = 60_000

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error('Generated file was not an ArrayBuffer.'))
    reader.onerror = () => reject(reader.error ?? new Error('Generated file could not be read.'))
    reader.readAsArrayBuffer(blob)
  })
}

describe('report export contracts', () => {
  it('ships the Excel templates required by weekly and service evidence exports', () => {
    for (const template of [
      'public/report-templates/formato-semanal-2026.xlsx',
      'public/report-templates/formato-evidencias-os.xlsx',
    ]) {
      const absolute = path.join(root, template)
      expect(fs.existsSync(absolute)).toBe(true)
      expect(fs.statSync(absolute).size).toBeGreaterThan(1024)
    }
  })

  it('keeps report templates free of styled empty rows that exhaust browser memory', () => {
    const compactSheets = [
      {
        template: 'public/report-templates/formato-evidencias-os.xlsx',
        sheet: 'xl/worksheets/sheet1.xml',
        dimension: '<dimension ref="A1:J64"/>',
        firstExcludedRow: '<row r="65"',
      },
      {
        template: 'public/report-templates/formato-semanal-2026.xlsx',
        sheet: 'xl/worksheets/sheet3.xml',
        dimension: '<dimension ref="A1:I2"/>',
        firstExcludedRow: '<row r="3"',
      },
    ]

    for (const contract of compactSheets) {
      const xml = require('node:child_process')
        .execFileSync('unzip', ['-p', contract.template, contract.sheet], {
          cwd: root,
          encoding: 'utf8',
        })

      expect(xml).toContain(contract.dimension)
      expect(xml).not.toContain(contract.firstExcludedRow)
      expect(Buffer.byteLength(xml)).toBeLessThan(1_000_000)
    }
  })

  it('bumps the template cache version whenever a report template changes', () => {
    // Cache Storage guarda las plantillas por URL y la URL no cambia entre versiones, así
    // que si se actualiza una plantilla sin subir TEMPLATE_CACHE_NAME el navegador del
    // administrador seguiría generando reportes con el catálogo anterior —y saldrían sin
    // código PEP—. Al cambiar cualquier plantilla esta huella cambia y obliga a subir la
    // versión y a actualizar este valor en el mismo commit.
    const fingerprint = require('node:crypto').createHash('sha256')
    for (const template of [
      'public/report-templates/formato-semanal-2026.xlsx',
      'public/report-templates/formato-evidencias-os.xlsx',
    ]) {
      fingerprint.update(fs.readFileSync(path.join(root, template)))
    }

    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const cacheName = /TEMPLATE_CACHE_NAME = '([^']+)'/.exec(reportes)?.[1]

    expect(`${cacheName} ${fingerprint.digest('hex').slice(0, 16)}`)
      .toBe('ran-report-templates-v4 7c48b2931f6cf8c9')
  })

  it('keeps export code wired to Supabase, R2 evidence downloads, workers, and browser downloads', () => {
    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const cierres = fs.readFileSync(path.join(root, 'src/lib/cierres-export.ts'), 'utf8')
    const servicios = fs.readFileSync(path.join(root, 'src/lib/servicios-export.ts'), 'utf8')
    const serviciosPage = fs.readFileSync(path.join(root, 'src/pages/admin/servicios/ServiciosPage.tsx'), 'utf8')
    const dialog = fs.readFileSync(path.join(root, 'src/components/shared/WeeklyReportExportDialog.tsx'), 'utf8')

    expect(reportes).toContain('WEEKLY_TEMPLATE_URL')
    expect(reportes).toContain('EVIDENCE_TEMPLATE_URL')
    expect(reportes).toContain("TEMPLATE_CACHE_NAME = 'ran-report-templates-v4'")
    expect(reportes).toContain('downloadEvidenciaBlob')
    expect(reportes).toContain('originalBlobToEmbeddedImage')
    expect(reportes).toContain('resolveServiceCustomerCode')
    expect(reportes).toContain('removeProtectionArtifacts')
    expect(reportes).toContain('removeProtectionArtifactsFromXlsxBytes')
    expect(reportes).toContain('workbookProtection')
    expect(reportes).toContain('sheetProtection')
    expect(reportes).toContain('getColumnStyleId')
    expect(reportes).toContain('WEEKLY_EVIDENCE_WORKBOOK_CONCURRENCY')
    expect(reportes).toContain('WEEKLY_EVIDENCE_WORKBOOK_CONCURRENCY = 1')
    expect(reportes).toContain('EVIDENCE_PHOTO_DOWNLOAD_CONCURRENCY = 2')
    expect(reportes).toContain('mapWithConcurrency(')
    expect(reportes).toContain('exportServiceEvidenceWorkbook')
    expect(reportes).toContain('exportWeeklyReportBundle')
    expect(reportes).toContain('WeeklyReportExportContentMode')
    expect(reportes).toContain('getWeeklyReportContentMode')
    expect(reportes).toContain('solo_reporte')
    expect(reportes).toContain('solo_evidencias')
    expect(reportes).toContain('instalaciones_retiros')
    expect(reportes).toContain('mantenimientos')
    expect(reportes).toContain('ambos')
    expect(reportes).toContain('filterBundlesByWeeklyReportMode')
    expect(reportes).toContain("new Worker(new URL('./reportes-export.worker.ts', import.meta.url)")
    expect(reportes).toContain('downloadBlob')
    expect(reportes).toContain('DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000')
    expect(reportes).not.toContain('URL.revokeObjectURL(fileUrl), 1_000')
    expect(reportes).toContain('shouldIncludeWeeklyWorkbook ? loadTemplateArrayBuffer(WEEKLY_TEMPLATE_URL)')
    expect(reportes).toContain('shouldIncludeEvidenceWorkbooks ? loadTemplateArrayBuffer(EVIDENCE_TEMPLATE_URL)')
    expect(cierres).toContain('exportCierresReport')
    expect(cierres).toContain('buildCierresReportBuffer')
    expect(cierres).toContain('buildCierresReportBlob')
    expect(cierres).toContain("workbook.addWorksheet('Hoja1')")
    expect(cierres).toContain(".gte('fecha_cierre'")
    expect(cierres).toContain(".lte('fecha_cierre'")
    expect(cierres).toContain('parte_objeto')
    expect(cierres).toContain('firma_receptor')
    expect(cierres).not.toContain('.insert(')
    expect(cierres).not.toContain('.update(')
    expect(cierres).not.toContain('.delete(')
    expect(serviciosPage).toContain('Reporte de cierres por fecha de cierre')
    expect(serviciosPage).toContain('Selecciona rango de fecha de cierre')
    expect(serviciosPage).toContain('El reporte de cierres usa la fecha en que se cerró el servicio')
    expect(serviciosPage).toContain("import('@/lib/cierres-export')")
    expect(serviciosPage).toContain('fechaInicio: filtros.fechaDesde')
    expect(serviciosPage).toContain('fechaFin: filtros.fechaHasta')
    expect(serviciosPage).toContain('DropdownMenuSub')
    expect(serviciosPage).toContain('Solo reporte semanal')
    expect(serviciosPage).toContain('Reporte + evidencias')
    expect(serviciosPage).toContain('Solo evidencias')
    expect(serviciosPage).toContain("'solo_reporte'")
    expect(serviciosPage).toContain("'solo_evidencias'")
    expect(servicios).toContain('exportServiciosExcel')
    expect(servicios).toContain("import('exceljs')")
    expect(servicios).toContain('workbook.xlsx.writeBuffer')
    expect(servicios).not.toContain("from 'xlsx'")
    expect(servicios).not.toContain('XLSX.writeFile')
    expect(dialog).toContain('WeeklyReportExportDialog')
    expect(dialog).toContain('onCancel')
    expect(dialog).toContain('onInteractOutside={(event) => event.preventDefault()}')
    expect(dialog).toContain('onEscapeKeyDown={(event) => event.preventDefault()}')
    expect(dialog).not.toContain('onOpenChange=')
  })

  it('applies the current payment catalog without carrying external workbook links', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )
    const requestedUrls: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)

      if (url.includes('/report-templates/formato-semanal-2026.xlsx')) {
        return new Response(weeklyTemplate, { status: 200 })
      }

      throw new Error(`Unexpected template request: ${url}`)
    })

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, [
      {
        servicio: buildServicio({
          tipo_servicio: 'INSTALACION USADA',
          status: 'completado',
          fecha_cierre: '2026-07-08',
          maquina: buildMaquina({ modelo: 'MODELO SIN CLASIFICAR' }),
        }),
        cierre: buildCierre({ created_at: '2026-07-08T18:00:00.000Z' }),
        refacciones: [buildServicioRefaccion({
          nombre_refaccion: 'Filtro de prueba',
          cantidad: 2,
          precio_unitario: 125,
          subtotal: 250,
        })],
        evidencias: [],
      },
      {
        servicio: buildServicio({
          id: 31,
          orden: 9002,
          aviso: 7002,
          tipo_servicio: 'INST MH SIX BASE',
          status: 'completado',
          fecha_cierre: '2026-07-08',
          maquina: buildMaquina({ modelo: 'MAQUINA HIELO SIX BASE' }),
        }),
        cierre: buildCierre({
          id: 111,
          servicio_id: 31,
          aviso: 7002,
          created_at: '2026-07-08T18:00:00.000Z',
        }),
        refacciones: [],
        evidencias: [],
      },
    ])

    const reportBuffer = await readBlobAsArrayBuffer(result.blob)
    const reportEntries = UZIP.parse(reportBuffer)
    const workbookXml = new TextDecoder().decode(reportEntries['xl/workbook.xml'])
    const ordersXml = new TextDecoder().decode(reportEntries['xl/worksheets/sheet2.xml'])
    const sparePartsXml = new TextDecoder().decode(reportEntries['xl/worksheets/sheet3.xml'])
    const catPepXml = new TextDecoder().decode(reportEntries['xl/worksheets/sheet6.xml'])
    const catPepTableXml = new TextDecoder().decode(reportEntries['xl/tables/table7.xml'])

    expect(Object.keys(reportEntries).some((name) => name.startsWith('xl/externalLinks/'))).toBe(false)
    expect(workbookXml).not.toContain('externalReference')
    expect(catPepXml).not.toContain('[1]BASE TRADE')
    expect(catPepTableXml).not.toContain('[1]BASE TRADE')
    expect(catPepTableXml).toContain('name="REGION"')
    expect(ordersXml).toContain('Caratula!$D$17')
    expect(ordersXml).toContain('<v>S2826</v>')
    expect(sparePartsXml).toContain('<v>NUEVO LEON</v>')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(reportBuffer)
    const orders = workbook.getWorksheet('Registro Ordenes')
    const spareParts = workbook.getWorksheet('Registro Refacciones')

    expect(orders?.getCell('A2').value).toMatchObject({ result: 4010269 })
    expect(orders?.getCell('B2').value).toMatchObject({ result: 'NUEVO LEON' })
    expect(orders?.getCell('C2').value).toMatchObject({ result: 'S2826' })
    expect(orders?.getCell('E2').value)
      .toBe('INSTALACION USADA - MAQUINA HIELO')
    expect(orders?.getCell('K2').value)
      .toBe('MAQUINA HIELO')
    expect(orders?.getCell('O2').value).toMatchObject({ result: 250 })
    expect(orders?.getCell('P2').value).toMatchObject({ result: 250 })
    expect(orders?.getCell('E3').value)
      .toBe('INST MH SIX BASE - MAQUINA HIELO')
    expect(spareParts?.getCell('B2').value).toBe(9001)
    expect(spareParts?.getCell('C2').value).toBe('REFACCIONES - MAQUINA HIELO')
    expect(spareParts?.getCell('F2').value).toBe('Filtro de prueba')
    expect(spareParts?.getCell('G2').value).toBe(2)
    expect(spareParts?.getCell('H2').value).toBe(125)
    expect(spareParts?.getCell('I2').value).toMatchObject({ result: 250 })
    expect(workbook.getWorksheet('CatPEP')?.rowCount).toBe(917)

    const paymentSummary = workbook.getWorksheet('Resumen para pago')
    const sixBaseRow = paymentSummary
      ? Array.from({ length: paymentSummary.rowCount }, (_, index) => paymentSummary.getRow(index + 1))
        .find((row) => row.getCell(4).value === 'INST MH SIX BASE - MAQUINA HIELO')
      : undefined

    expect(sixBaseRow?.getCell(5).value).toBe('M/MXCM/26/CAF1/C2/515/01')
    expect(sixBaseRow?.getCell(6).value).toBe('DESARROLLO FRIO')
    expect(requestedUrls).toEqual(['/report-templates/formato-semanal-2026.xlsx?v=ran-report-templates-v4'])
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('resolves the 2026 freight concepts to a PEP using the catalog spelling', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(weeklyTemplate, { status: 200 })
    ))

    // Heineken publica el concepto de máquina de hielo con espacio doble
    // ("FLETE MOV GZ  A GZ") mientras que el resto de los equipos usan uno solo.
    // El sistema guarda el nombre normalizado, así que el export tiene que escribir
    // la variante del catálogo: el archivo entregado conserva el XLOOKUP vivo y una
    // diferencia de un espacio deja la columna PEP vacía y el cobro se rechaza.
    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, [
      {
        servicio: buildServicio({
          id: 41,
          orden: 9101,
          aviso: 7101,
          tipo_servicio: 'FLETE MOV GZ A GZ - MAQUINA HIELO',
          status: 'completado',
          fecha_cierre: '2026-07-08',
          maquina: buildMaquina({ modelo: 'KM901' }),
        }),
        cierre: buildCierre({ id: 121, servicio_id: 41, aviso: 7101 }),
        refacciones: [],
        evidencias: [],
      },
      {
        servicio: buildServicio({
          id: 42,
          orden: 9102,
          aviso: 7102,
          tipo_servicio: 'FLETE MOV CEDIS A CEDIS - MAQUINA HIELO',
          status: 'completado',
          fecha_cierre: '2026-07-08',
          maquina: buildMaquina({ modelo: 'KM901' }),
        }),
        cierre: buildCierre({ id: 122, servicio_id: 42, aviso: 7102 }),
        refacciones: [],
        evidencias: [],
      },
      {
        servicio: buildServicio({
          id: 43,
          orden: 9103,
          aviso: 7103,
          tipo_servicio: 'FLETES-TALLER - MOVIMIENTOS',
          status: 'completado',
          fecha_cierre: '2026-07-08',
          maquina: buildMaquina({ modelo: 'KM901' }),
        }),
        cierre: buildCierre({ id: 123, servicio_id: 43, aviso: 7103 }),
        refacciones: [],
        evidencias: [],
      },
    ])

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await readBlobAsArrayBuffer(result.blob))
    const orders = workbook.getWorksheet('Registro Ordenes')

    expect(orders?.getCell('E2').value).toBe('FLETE MOV GZ  A GZ - MAQUINA HIELO')
    expect(orders?.getCell('E3').value).toBe('FLETE MOV CEDIS A CEDIS - MAQUINA HIELO')
    expect(orders?.getCell('E4').value).toBe('FLETES-TALLER - MOVIMIENTOS')

    const paymentSummary = workbook.getWorksheet('Resumen para pago')
    const summaryRows = paymentSummary
      ? Array.from({ length: paymentSummary.rowCount }, (_, index) => paymentSummary.getRow(index + 1))
      : []

    const pepFor = (tipoServicio: string) => summaryRows
      .find((row) => row.getCell(4).value === tipoServicio)
      ?.getCell(5).value

    expect(pepFor('FLETE MOV GZ  A GZ - MAQUINA HIELO')).toBe('M/MXCM/26/GA6B/C6/815/03')
    expect(pepFor('FLETE MOV CEDIS A CEDIS - MAQUINA HIELO')).toBe('M/MXCM/26/GA6B/C6/815/03')
    expect(pepFor('FLETES-TALLER - MOVIMIENTOS')).toBe('M/MXCM/26/CG7L/C2/815/01')
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('keeps every column name exactly as Heineken publishes it', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(weeklyTemplate, { status: 200 })
    ))

    // El sistema de Heineken procesa estos archivos identificando las columnas por
    // nombre, así que cualquier cambio de encabezado —por más razonable que parezca—
    // rompe su proceso. "Fecha Cierre" lleva la fecha de servicio a propósito (87cb7f9):
    // el dato cambió, el nombre de la columna no puede cambiar.
    const heinekenOrderColumns = [
      'Proveedor', 'GZ', 'Periodo', 'SelGZ', 'Tipo de Servicio', 'PEP', 'Nombre el PEP',
      'Aviso', 'Orden', 'Cliente', 'Equipo', 'Serie', 'Fecha Cierre', 'Costo Servicio',
      'Refacciones', 'Total', 'Comentarios',
    ]
    const heinekenSparePartColumns = [
      'SelGZ', 'Orden de Servicio', 'Equipo', 'PEP', 'Nombre PEP', 'Refacción',
      'Cantidad', 'Precio Unitario', 'Precio Total',
    ]

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, [{
      servicio: buildServicio({
        id: 80,
        orden: 9700,
        aviso: 7700,
        tipo_servicio: 'MTTO CORRECTIVO RUTA - MAQUINA HIELO',
        status: 'completado',
        fecha_cierre: '2026-07-08',
        maquina: buildMaquina({ modelo: 'KM901' }),
      }),
      cierre: buildCierre({ id: 160, servicio_id: 80, aviso: 7700 }),
      refacciones: [],
      evidencias: [],
    }])

    const reportBuffer = await readBlobAsArrayBuffer(result.blob)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(reportBuffer)

    const orders = workbook.getWorksheet('Registro Ordenes')
    const spareParts = workbook.getWorksheet('Registro Refacciones')

    expect(heinekenOrderColumns.map((_, index) => orders?.getRow(1).getCell(index + 1).value))
      .toEqual(heinekenOrderColumns)
    expect(heinekenSparePartColumns.map((_, index) => spareParts?.getRow(1).getCell(index + 1).value))
      .toEqual(heinekenSparePartColumns)

    // Excel también guarda los nombres dentro de la definición de la tabla, y ahí es donde
    // los leería un proceso automatizado que abra el archivo por API.
    const ordersTableXml = new TextDecoder().decode(UZIP.parse(reportBuffer)['xl/tables/table1.xml'])
    for (const columnName of heinekenOrderColumns) {
      expect(ordersTableXml).toContain(`name="${columnName}"`)
    }
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('widens the currency columns so large totals never render as #####', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(weeklyTemplate, { status: 200 })
    ))

    // La plantilla de Heineken trae la columna de total del resumen a 8.57 de ancho,
    // heredado de una tabla dinámica. Con el formato contable un importe de siete cifras
    // se dibuja como "$ 9,876,543.21" y Excel lo reemplaza por "#####", obligando al
    // taller a ensanchar la columna antes de poder leer o enviar el reporte.
    const costoServicio = 9_876_543.21
    const costoRefaccion = 2_345_678.99

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, [{
      servicio: buildServicio({
        id: 70,
        orden: 9600,
        aviso: 7600,
        tipo_servicio: 'MTTO CORRECTIVO RUTA - MAQUINA HIELO',
        status: 'completado',
        fecha_cierre: '2026-07-08',
        costo_mano_obra: costoServicio,
        maquina: buildMaquina({ modelo: 'KM901' }),
      }),
      cierre: buildCierre({ id: 150, servicio_id: 70, aviso: 7600 }),
      refacciones: [buildServicioRefaccion({
        nombre_refaccion: 'COMPRESOR',
        cantidad: 1,
        precio_unitario: costoRefaccion,
        subtotal: costoRefaccion,
      })],
      evidencias: [],
    }])

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await readBlobAsArrayBuffer(result.blob))

    // Ancho mínimo que necesita el texto que Excel dibuja, p. ej. "$ 12,222,222.20".
    const rendered = `$ ${(costoServicio + costoRefaccion).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    })}`

    const summaryTotalWidth = workbook.getWorksheet('Resumen para pago')?.getColumn('G').width ?? 0
    const ordersCostWidth = workbook.getWorksheet('Registro Ordenes')?.getColumn('N').width ?? 0

    expect(summaryTotalWidth).toBeGreaterThanOrEqual(rendered.length)
    expect(ordersCostWidth).toBeGreaterThanOrEqual(rendered.length)
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('expands legacy service types stored without an equipment suffix', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(weeklyTemplate, { status: 200 })
    ))

    // Buena parte del histórico se capturó sin el sufijo de equipo ("INSTALACION" en vez
    // de "INSTALACION - MAQUINA HIELO"). Esos registros se resuelven por la hoja Sheet2 de
    // la plantilla, un camino distinto al de los nombres completos, y dependen de que
    // exceljs pueda leer el valor en caché de una fórmula. Si Sheet2 dejara de traer ese
    // valor, estos servicios saldrían sin código PEP y sin fallar de forma visible.
    const legacyTypes: Array<[string, string, string]> = [
      ['INSTALACION', 'INSTALACION - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/01'],
      ['RETIRO', 'RETIRO - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/01'],
    ]

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, legacyTypes.map(([tipoServicio], index) => ({
      servicio: buildServicio({
        id: 60 + index,
        orden: 9400 + index,
        aviso: 7400 + index,
        tipo_servicio: tipoServicio,
        status: 'completado',
        fecha_cierre: '2026-07-08',
        maquina: buildMaquina({ modelo: 'KM901' }),
      }),
      cierre: buildCierre({ id: 140 + index, servicio_id: 60 + index, aviso: 7400 + index }),
      refacciones: [],
      evidencias: [],
    })))

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await readBlobAsArrayBuffer(result.blob))
    const orders = workbook.getWorksheet('Registro Ordenes')
    const paymentSummary = workbook.getWorksheet('Resumen para pago')
    const summaryRows = paymentSummary
      ? Array.from({ length: paymentSummary.rowCount }, (_, index) => paymentSummary.getRow(index + 1))
      : []

    legacyTypes.forEach(([, expandedType, pep], index) => {
      expect(orders?.getCell(`E${index + 2}`).value).toBe(expandedType)
      expect(summaryRows.find((row) => row.getCell(4).value === expandedType)?.getCell(5).value)
        .toBe(pep)
    })
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('keeps the PEP of every pre-2026 concept unchanged after the catalog update', async () => {
    const weeklyTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-semanal-2026.xlsx')),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(weeklyTemplate, { status: 200 })
    ))

    // Códigos verificados contra la plantilla anterior al catálogo 2026, concepto por
    // concepto. Si alguno cambia, un reporte de una semana ya cobrada dejaría de
    // coincidir con lo que Heineken tiene registrado.
    const expectedPeps: Array<[string, string, string]> = [
      ['MTTO CORRECTIVO RUTA - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/04', 'MTTO MAQUINA HIELO'],
      ['MTTO CORRECTIVO PISO - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/04', 'MTTO MAQUINA HIELO'],
      ['MTTO PREVENTIVO RUTA - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/04', 'MTTO MAQUINA HIELO'],
      ['INSTALACION - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/01', 'MOVIMIENTOS'],
      ['RETIRO - MAQUINA HIELO', 'M/MXCM/26/CG7L/C2/815/01', 'MOVIMIENTOS'],
    ]

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'todos',
      contentMode: 'solo_reporte',
    }, expectedPeps.map(([tipoServicio], index) => ({
      servicio: buildServicio({
        id: 50 + index,
        orden: 9300 + index,
        aviso: 7300 + index,
        tipo_servicio: tipoServicio,
        status: 'completado',
        fecha_cierre: '2026-07-08',
        maquina: buildMaquina({ modelo: 'KM901' }),
      }),
      cierre: buildCierre({ id: 130 + index, servicio_id: 50 + index, aviso: 7300 + index }),
      refacciones: [],
      evidencias: [],
    })))

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await readBlobAsArrayBuffer(result.blob))
    const orders = workbook.getWorksheet('Registro Ordenes')
    const paymentSummary = workbook.getWorksheet('Resumen para pago')
    const summaryRows = paymentSummary
      ? Array.from({ length: paymentSummary.rowCount }, (_, index) => paymentSummary.getRow(index + 1))
      : []

    expectedPeps.forEach(([tipoServicio, pep, nombrePep], index) => {
      expect(orders?.getCell(`E${index + 2}`).value).toBe(tipoServicio)

      const summaryRow = summaryRows.find((row) => row.getCell(4).value === tipoServicio)
      expect(summaryRow?.getCell(5).value).toBe(pep)
      expect(summaryRow?.getCell(6).value).toBe(nombrePep)
    })
  }, HEAVY_WORKBOOK_TIMEOUT_MS)

  it('builds evidence-only ZIPs without loading or generating the weekly workbook', async () => {
    const evidenceTemplate = new Uint8Array(
      fs.readFileSync(path.join(root, 'public/report-templates/formato-evidencias-os.xlsx')),
    )
    const requestedUrls: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)

      if (url.includes('/report-templates/formato-evidencias-os.xlsx')) {
        return new Response(evidenceTemplate, { status: 200 })
      }

      throw new Error(`Unexpected template request: ${url}`)
    })

    const result = await buildWeeklyReportBundleFromBundles({
      semana: 'S2826',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-11',
      reportMode: 'instalaciones_retiros',
      contentMode: 'solo_evidencias',
    }, [{
      servicio: buildServicio({
        tipo_servicio: 'INSTALACION USADA',
        status: 'completado',
        fecha_cierre: '2026-07-08',
      }),
      cierre: buildCierre({ created_at: '2026-07-08T18:00:00.000Z' }),
      refacciones: [],
      evidencias: [],
    }])

    const zipEntries = UZIP.parse(await readBlobAsArrayBuffer(result.blob))
    const entryNames = Object.keys(zipEntries)

    expect(entryNames).toEqual(['9001_INSTALACION USADA.xlsx'])
    expect(entryNames.some((name) => name.includes('ReporteSemanal.xlsx'))).toBe(false)
    expect(requestedUrls).toEqual(['/report-templates/formato-evidencias-os.xlsx?v=ran-report-templates-v4'])

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(zipEntries[entryNames[0]])
    expect(workbook.getWorksheet('Carátula')?.getCell('B7').value).toBe(9001)
  })

  it('keeps the weekly service date as a real Excel date and preserves valid formatting XML', () => {
    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const templateXml = require('node:child_process')
      .execFileSync('unzip', ['-p', 'public/report-templates/formato-semanal-2026.xlsx', 'xl/worksheets/sheet2.xml'], {
        cwd: root,
        encoding: 'utf8',
      })

    expect(templateXml).toMatch(/conditionalFormatting[^>]*sqref="M1:M1048576"/)
    expect(templateXml).toContain('<xm:sqref>M1:M1048576</xm:sqref>')
    expect(reportes).toContain("const dateStyleId = getColumnStyleId(document, 'M')")
    expect(reportes).toContain("setNumber(document, row, 'M', data.fechaServicioExcel, dateStyleId)")
    // El encabezado conserva el nombre de Heineken aunque el dato sea la fecha de
    // servicio: su sistema localiza las columnas por nombre.
    expect(reportes).not.toContain("'Fecha Servicio'")
    expect(reportes).not.toContain('removeConditionalFormattingForColumn(document')
  })

  it('removes worksheet and workbook protection from weekly and evidence exports', () => {
    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const weeklySheetXml = require('node:child_process')
      .execFileSync('unzip', ['-p', 'public/report-templates/formato-semanal-2026.xlsx', 'xl/worksheets/sheet2.xml'], {
        cwd: root,
        encoding: 'utf8',
      })
    const evidenceWorkbookXml = require('node:child_process')
      .execFileSync('unzip', ['-p', 'public/report-templates/formato-evidencias-os.xlsx', 'xl/workbook.xml'], {
        cwd: root,
        encoding: 'utf8',
      })

    expect(weeklySheetXml).toContain('sheetProtection')
    expect(evidenceWorkbookXml).toContain('workbookProtection')
    expect(reportes).toContain('removeProtectionArtifacts(files)')
    expect(reportes).toContain('removeProtectionArtifactsFromXlsxBytes')
    expect(reportes).toContain("getElementsByLocalName(sheetDoc, 'sheetProtection')")
    expect(reportes).toContain("getDirectChildElementsByLocalName(workbookRoot, 'workbookProtection')")
  })

  it('builds a repair-safe cierres workbook without external links', async () => {
    const buffer = await buildCierresReportBuffer([
      {
        servicio: buildServicio({
          aviso: 30006000794,
          total: 914,
          descripcion: 'NL SIX 4 PIRAMIDE..SE HIZO LIMPIEZA A MAQUINA',
          cliente: {
            ...buildServicio().cliente!,
            nombre: 'NL SIX 4 PIRAMIDE',
          },
          tecnico: {
            ...buildServicio().tecnico!,
            nombre: 'JAIME GATICA',
          },
        }),
        cierre: buildCierre({
          aviso: 30006000794,
          parte_objeto: '1130',
          causa: '1740',
          descripcion: 'NL SIX 4 PIRAMIDE..SE HIZO LIMPIEZA A MAQUINA',
          costo_total: 914,
          firma_receptor: 'SOLO FIRMA',
          tecnico: {
            ...buildServicio().tecnico!,
            nombre: 'JAIME GATICA',
          },
        }),
      },
    ])

    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    const entries = UZIP.parse(bytes)

    expect(Object.keys(entries).some((name) => name.startsWith('xl/externalLinks/'))).toBe(false)
    expect(entries['xl/workbook.xml']).toBeTruthy()
    expect(new TextDecoder().decode(entries['xl/workbook.xml'])).not.toContain('externalReference')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const worksheet = workbook.getWorksheet('Hoja1')

    expect(worksheet?.getCell('A2').value).toBe('AVISO')
    expect(worksheet?.getCell('A3').value).toBe(30006000794)
    expect(worksheet?.getCell('B3').value).toBe('1130')
    expect(worksheet?.getCell('C3').value).toBe('1740')
    expect(worksheet?.getCell('D3').value).toBe('NL SIX 4 PIRAMIDE..SE HIZO LIMPIEZA A MAQUINA')
    expect(worksheet?.getCell('E3').value).toBe(914)
    expect(worksheet?.getCell('F3').value).toBe('JAIME GATICA')
    expect(worksheet?.getCell('G3').value).toBe('SOLO FIRMA')
    expect(worksheet?.getCell('I15').value).toBeNull()
    expect(worksheet?.getCell('J15').value).toBeNull()
  })
})
