import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const routerSource = fs.readFileSync(path.join(process.cwd(), 'src/router.tsx'), 'utf8')

describe('router contracts', () => {
  it('keeps the admin surface mounted behind the admin layout and role guard', () => {
    expect(routerSource).toContain('<RequireRole role="admin">')
    expect(routerSource).toContain('<AppLayout />')

    for (const route of [
      'servicios',
      'servicios/nuevo',
      'servicios/:id',
      'servicios/:id/editar',
      'polizas',
      'polizas/nueva',
      'polizas/asignar-mantenimiento',
      'polizas/mantenimientos',
      'inventario',
      'inventario/tecnico',
      'inventario/movimientos',
      'maquinas-taller',
      'catalogos',
      'catalogos/clientes/nuevo',
      'catalogos/clientes/:id',
      'catalogos/empleados',
      'catalogos/maquinas',
    ]) {
      expect(routerSource).toContain(`path: '${route}'`)
    }
  })

  it('keeps the technician mobile surface behind the technician layout and role guard', () => {
    expect(routerSource).toContain('<RequireRole role="tecnico">')
    expect(routerSource).toContain('<MobileLayout />')

    for (const route of [
      'tecnico',
      'tecnico/mantenimiento/:id',
      'tecnico/servicio/:id',
      'tecnico/servicio/:id/evidencia',
      'tecnico/inventario',
      'tecnico/perfil',
      'tecnico/servicio/:id/refacciones',
    ]) {
      expect(routerSource).toContain(`path: '${route}'`)
    }
  })

  it('redirects unauthenticated or inactive users back to login and cross-role users to their own surface', () => {
    expect(routerSource).toContain('if (!user) return <Navigate to="/login" replace />')
    expect(routerSource).toContain('if (!perfil?.activo) return <Navigate to="/login" replace />')
    expect(routerSource).toContain("perfil.role === 'admin' ? '/' : '/tecnico'")
  })
})
