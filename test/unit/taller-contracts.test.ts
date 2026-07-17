import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildFallbackReportServiceType,
  DEFAULT_REPORT_EQUIPMENT_TYPE,
  isInstallationServiceType,
  isRetiroServiceType,
  normalizeReportServiceType,
  normalizeServiceType,
} from '@/lib/service-types'

const root = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('workshop machine contracts', () => {
  it('matches workshop service types with accents and free-text casing', () => {
    expect(normalizeServiceType('Instalación - máquina hielo')).toContain('INSTALACION')
    expect(isInstallationServiceType('INSTALACIÓN - MAQUINA HIELO')).toBe(true)
    expect(isRetiroServiceType('retiro - maquina hielo')).toBe(true)
  })

  it('normalizes legacy cooler labels to the equipment used by RAN reports', () => {
    expect(DEFAULT_REPORT_EQUIPMENT_TYPE).toBe('MAQUINA HIELO')
    expect(normalizeReportServiceType('INSTALACION USADA - ENFRIADOR'))
      .toBe('INSTALACION USADA - MAQUINA HIELO')
    expect(normalizeReportServiceType('MTTO - enfriadores'))
      .toBe('MTTO - MAQUINA HIELO')
    expect(buildFallbackReportServiceType('INSTALACION USADA'))
      .toBe('INSTALACION USADA - MAQUINA HIELO')
  })

  it('allows admins to remove open workshop records without deleting machines or services', () => {
    const hook = read('src/hooks/use-maquinas-taller.ts')
    const page = read('src/pages/admin/maquinas-taller/MaquinasTallerPage.tsx')

    expect(hook).toContain('useEliminarMaquinaTallerMutation')
    expect(hook).toContain('Solo se pueden quitar registros abiertos de taller.')
    expect(hook).toContain('.maybeSingle()')
    expect(hook).toContain('return input.registro_id')
    expect(hook).toContain(".from('maquinas_taller_movimientos')")
    expect(hook).toContain(".eq('maquina_taller_id', registro.id)")
    expect(hook).toContain(".from('maquinas_en_taller')")
    expect(hook).toContain(".delete()")
    expect(hook).toContain("status: 'operando'")
    expect(hook).not.toContain("from('servicios').delete")
    expect(hook).not.toContain("from('maquinas').delete")

    expect(page).toContain('Quitar de taller')
    expect(page).toContain('¿Quitar máquina de taller?')
    expect(page).toContain('useEliminarMaquinaTallerMutation')
    expect(page).toContain('ConfirmDialog')
  })

  it('keeps workshop cache and service lifecycle invalidations aligned with Supabase triggers', () => {
    const cache = read('src/lib/offline/cache.ts')
    const hook = read('src/hooks/use-maquinas-taller.ts')
    const servicios = read('src/hooks/use-servicios.ts')
    const cierres = read('src/hooks/use-cierres.ts')
    const syncEngine = read('src/lib/offline/sync-engine.ts')

    expect(cache).toContain('replaceCachedMaquinasTallerSnapshot')
    expect(cache).toContain('replaceCachedMaquinasTallerMovimientosSnapshot')
    expect(hook).toContain('replaceCachedMaquinasTallerSnapshot(ownerId, data as MaquinaEnTaller[], { soloAbiertas })')
    expect(hook).toContain('replaceCachedMaquinasTallerMovimientosSnapshot(ownerId, data as MaquinaTallerMovimiento[]')
    expect(servicios).toContain('useCompletarServicioConRefaccionesMutation')
    expect(servicios).toContain('maquinasTallerKeys.all')
    expect(cierres).toContain('useCerrarServicioMutation')
    expect(cierres).toContain('maquinasTallerKeys.all')
    expect(syncEngine).toContain('reconcileServiceWorkshopSnapshotsAfterSync')
    expect(syncEngine).toContain("select('id, maquina_id, status, costo_refacciones, total, updated_at')")
  })

  it('deletes pure temporary installation machines when a saved service changes type', () => {
    const serviciosActions = read('src/lib/offline/servicios-actions.ts')

    expect(serviciosActions).toContain('maybeDeletePendingInstallationMachineLocal')
    expect(serviciosActions).toContain('maybeDeletePendingInstallationMachineRemote')
    expect(serviciosActions).toContain('deletePendingInstallationMachineCache')
    expect(serviciosActions).toContain("command.type !== 'maquina.create'")
    expect(serviciosActions).toContain("supabase.from('polizas').select('id').eq('maquina_id', maquinaId)")
    expect(serviciosActions).toContain("supabase.from('mantenimientos_poliza').select('id').eq('maquina_id', maquinaId)")
    expect(serviciosActions).toContain("supabase.from('maquinas_en_taller').select('id').eq('maquina_id', maquinaId)")
    expect(serviciosActions).toContain("supabase.from('maquinas_taller_movimientos').select('id').eq('maquina_id', maquinaId)")
    expect(serviciosActions).toContain(".from('maquinas')\n    .delete()")
    expect(serviciosActions).not.toContain('maybeArchivePendingInstallationMachine')
    expect(serviciosActions).not.toContain('update({ activo: false })')
  })

  it('uses the same robust reubicacion sync path online and offline', () => {
    const maquinasHook = read('src/hooks/use-maquinas.ts')
    const tallerHook = read('src/hooks/use-maquinas-taller.ts')
    const tallerActions = read('src/lib/offline/taller-actions.ts')

    expect(maquinasHook).toContain("'taller.registrar_salida'")
    expect(maquinasHook).toContain("'taller.reubicacion'")
    expect(tallerHook).toContain('syncRegistrarReubicacionTaller(ownerId')
    expect(tallerHook).toContain('previousClienteId: maquina.cliente_id ?? null')
    expect(tallerActions).toContain('if (!movement && payload.previousClienteId !== remoteClienteDestinoId)')
    expect(tallerActions).toContain("accion: 'reubicacion'")
    expect(tallerActions).toContain("origen: payload.previousClienteId ? `cliente:${String(payload.previousClienteId)}` : 'sin_cliente'")
  })

  it('supports workshop reports and auditable diagnostic updates', () => {
    const hook = read('src/hooks/use-maquinas-taller.ts')
    const page = read('src/pages/admin/maquinas-taller/MaquinasTallerPage.tsx')
    const exportModule = read('src/lib/maquinas-taller-export.ts')

    expect(page).toContain('handleExportarReporteTaller')
    expect(page).toContain("import('@/lib/maquinas-taller-export')")
    expect(page).toContain('Reporte')
    expect(exportModule).toContain('exportMaquinasTallerReport')
    expect(exportModule).toContain('workbook.addWorksheet')
    expect(exportModule).toContain('maquinas-taller-')
    expect(hook).toContain('useActualizarDiagnosticoTallerMutation')
    expect(hook).toContain("accion: 'nota'")
    expect(hook).toContain("motivo: 'diagnostico'")
    expect(hook).toContain('buildDiagnosticChangeDetail')
    expect(page).toContain('Editar diagnóstico')
    expect(page).toContain('Guardar diagnóstico')
  })
})
