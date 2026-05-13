import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import UZIP from 'uzip'
import { buildCierresReportBuffer } from '@/lib/cierres-export'
import { buildCierre, buildServicio } from '../fixtures/domain'

const root = process.cwd()

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

  it('keeps export code wired to Supabase, R2 evidence downloads, workers, and browser downloads', () => {
    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const cierres = fs.readFileSync(path.join(root, 'src/lib/cierres-export.ts'), 'utf8')
    const servicios = fs.readFileSync(path.join(root, 'src/lib/servicios-export.ts'), 'utf8')
    const serviciosPage = fs.readFileSync(path.join(root, 'src/pages/admin/servicios/ServiciosPage.tsx'), 'utf8')
    const dialog = fs.readFileSync(path.join(root, 'src/components/shared/WeeklyReportExportDialog.tsx'), 'utf8')

    expect(reportes).toContain('WEEKLY_TEMPLATE_URL')
    expect(reportes).toContain('EVIDENCE_TEMPLATE_URL')
    expect(reportes).toContain('downloadEvidenciaBlob')
    expect(reportes).toContain('originalBlobToEmbeddedImage')
    expect(reportes).toContain('resolveServiceCustomerCode')
    expect(reportes).toContain('removeProtectionArtifacts')
    expect(reportes).toContain('removeProtectionArtifactsFromXlsxBytes')
    expect(reportes).toContain('workbookProtection')
    expect(reportes).toContain('sheetProtection')
    expect(reportes).toContain('setTableColumnName')
    expect(reportes).toContain('getColumnStyleId')
    expect(reportes).toContain('replaceConditionalFormattingFormulaText')
    expect(reportes).toContain("'Fecha Cierre', 'Fecha Servicio'")
    expect(reportes).toContain("'Fecha Servicio'")
    expect(reportes).toContain('WEEKLY_EVIDENCE_WORKBOOK_CONCURRENCY')
    expect(reportes).toContain('mapWithConcurrency(')
    expect(reportes).toContain('exportServiceEvidenceWorkbook')
    expect(reportes).toContain('exportWeeklyReportBundle')
    expect(reportes).toContain('instalaciones_retiros')
    expect(reportes).toContain('mantenimientos')
    expect(reportes).toContain('ambos')
    expect(reportes).toContain('filterBundlesByWeeklyReportMode')
    expect(reportes).toContain("new Worker(new URL('./reportes-export.worker.ts', import.meta.url)")
    expect(reportes).toContain('downloadBlob')
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
    expect(servicios).toContain('exportServiciosExcel')
    expect(servicios).toContain("import('exceljs')")
    expect(servicios).toContain('workbook.xlsx.writeBuffer')
    expect(servicios).not.toContain("from 'xlsx'")
    expect(servicios).not.toContain('XLSX.writeFile')
    expect(dialog).toContain('WeeklyReportExportDialog')
    expect(dialog).toContain('onCancel')
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
    expect(reportes).toContain("replaceConditionalFormattingFormulaText(document, 'Fecha Cierre', 'Fecha Servicio')")
    expect(reportes).toContain("setNumber(document, row, 'M', data.fechaServicioExcel, dateStyleId)")
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
