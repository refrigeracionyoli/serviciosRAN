import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('service delete contracts', () => {
  it('exposes service deletion from the admin services action menu', () => {
    const serviciosPage = read('src/pages/admin/servicios/ServiciosPage.tsx')

    expect(serviciosPage).toContain('useEliminarServicioMutation')
    expect(serviciosPage).toContain('Eliminar')
    expect(serviciosPage).toContain('¿Eliminar servicio?')
    expect(serviciosPage).toContain('Eliminar servicio')
  })

  it('routes service deletion through the protected admin edge function', () => {
    const r2Client = read('src/lib/r2.ts')
    const serviciosHook = read('src/hooks/use-servicios.ts')

    expect(r2Client).toContain("'admin-delete-servicio'")
    expect(r2Client).toContain('deleteServicioCompleto')
    expect(serviciosHook).toContain('No se puede eliminar un servicio sin conexión')
    expect(serviciosHook).toContain('removeCachedServicio')
    expect(serviciosHook).toContain('queryKey: maquinasKeys.all')
    expect(serviciosHook).toContain('queryKey: maquinasTallerKeys.all')
  })
})
