import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('workshop machine contracts', () => {
  it('allows admins to remove open workshop records without deleting machines or services', () => {
    const hook = read('src/hooks/use-maquinas-taller.ts')
    const page = read('src/pages/admin/maquinas-taller/MaquinasTallerPage.tsx')

    expect(hook).toContain('useEliminarMaquinaTallerMutation')
    expect(hook).toContain('Solo se pueden quitar registros abiertos de taller.')
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
})
