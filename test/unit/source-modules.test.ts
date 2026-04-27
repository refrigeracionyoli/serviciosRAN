import { describe, expect, it } from 'vitest'

const sourceModules = Object.entries(import.meta.glob('/src/**/*.{ts,tsx}'))
  .filter(([modulePath]) => {
    if (modulePath.endsWith('.d.ts')) return false
    if (modulePath === '/src/main.tsx') return false
    return true
  })
  .sort(([left], [right]) => left.localeCompare(right))

describe('source module contracts', () => {
  it('covers every importable source module except browser entrypoints and typings', () => {
    expect(sourceModules.length).toBeGreaterThan(100)
    expect(sourceModules.map(([modulePath]) => modulePath)).toEqual(
      expect.arrayContaining([
        '/src/App.tsx',
        '/src/router.tsx',
        '/src/lib/offline/cache.ts',
        '/src/lib/offline/commands.ts',
        '/src/pages/admin/servicios/ServiciosPage.tsx',
        '/src/pages/tecnico/TecnicoHomePage.tsx',
      ]),
    )
  })

  it.each(sourceModules)('imports %s without module-level failures', async (_modulePath, loadModule) => {
    await expect(loadModule()).resolves.toBeDefined()
  })
})
