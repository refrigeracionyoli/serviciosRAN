import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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

  it('keeps export code wired to Supabase, R2 presigned URLs, workers, and browser downloads', () => {
    const reportes = fs.readFileSync(path.join(root, 'src/lib/reportes-export.ts'), 'utf8')
    const servicios = fs.readFileSync(path.join(root, 'src/lib/servicios-export.ts'), 'utf8')
    const dialog = fs.readFileSync(path.join(root, 'src/components/shared/WeeklyReportExportDialog.tsx'), 'utf8')

    expect(reportes).toContain('WEEKLY_TEMPLATE_URL')
    expect(reportes).toContain('EVIDENCE_TEMPLATE_URL')
    expect(reportes).toContain('getPresignedGetUrl')
    expect(reportes).toContain('exportServiceEvidenceWorkbook')
    expect(reportes).toContain('exportWeeklyReportBundle')
    expect(reportes).toContain("new Worker(new URL('./reportes-export.worker.ts', import.meta.url)")
    expect(reportes).toContain('downloadBlob')
    expect(servicios).toContain('exportServiciosExcel')
    expect(servicios).toContain('XLSX.writeFile')
    expect(dialog).toContain('WeeklyReportExportDialog')
    expect(dialog).toContain('onCancel')
  })
})
