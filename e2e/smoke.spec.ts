import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { installSupabaseMock, type E2ERole } from './fixtures/supabase-mock'

interface SmokeRoute {
  path: string
  name: string
  role: E2ERole
  expectedPath?: RegExp
}

const adminRoutes: SmokeRoute[] = [
  { name: 'dashboard', path: '/', role: 'admin', expectedPath: /\/$/ },
  { name: 'servicios list', path: '/servicios', role: 'admin' },
  { name: 'servicio nuevo', path: '/servicios/nuevo', role: 'admin' },
  { name: 'servicio detalle', path: '/servicios/1', role: 'admin' },
  { name: 'servicio editar', path: '/servicios/1/editar', role: 'admin' },
  { name: 'polizas list', path: '/polizas', role: 'admin' },
  { name: 'poliza nueva', path: '/polizas/nueva', role: 'admin' },
  { name: 'asignar mantenimiento', path: '/polizas/asignar-mantenimiento', role: 'admin' },
  { name: 'poliza detalle', path: '/polizas/1', role: 'admin' },
  { name: 'mantenimientos list', path: '/polizas/mantenimientos', role: 'admin' },
  { name: 'mantenimiento detalle', path: '/polizas/mantenimientos/1', role: 'admin' },
  { name: 'inventario general', path: '/inventario', role: 'admin' },
  { name: 'inventario tecnico admin', path: '/inventario/tecnico', role: 'admin' },
  { name: 'movimientos inventario', path: '/inventario/movimientos', role: 'admin' },
  { name: 'maquinas taller', path: '/maquinas-taller', role: 'admin' },
  { name: 'catalogos hub', path: '/catalogos', role: 'admin' },
  { name: 'cliente nuevo', path: '/catalogos/clientes/nuevo', role: 'admin' },
  { name: 'cliente detalle', path: '/catalogos/clientes/1', role: 'admin' },
  { name: 'cliente editar', path: '/catalogos/clientes/1/editar', role: 'admin' },
  { name: 'empleados list', path: '/catalogos/empleados', role: 'admin' },
  { name: 'empleado nuevo', path: '/catalogos/empleados/nuevo', role: 'admin' },
  { name: 'tecnicos legacy redirect', path: '/catalogos/tecnicos', role: 'admin', expectedPath: /\/catalogos\/empleados$/ },
  { name: 'tecnico nuevo legacy redirect', path: '/catalogos/tecnicos/nuevo', role: 'admin', expectedPath: /\/catalogos\/empleados\/nuevo$/ },
  { name: 'maquinas list', path: '/catalogos/maquinas', role: 'admin' },
  { name: 'maquina historial', path: '/catalogos/maquinas/1/historial', role: 'admin' },
]

const tecnicoRoutes: SmokeRoute[] = [
  { name: 'tecnico home', path: '/tecnico', role: 'tecnico' },
  { name: 'tecnico mantenimiento', path: '/tecnico/mantenimiento/1', role: 'tecnico' },
  { name: 'tecnico servicio detalle', path: '/tecnico/servicio/1', role: 'tecnico' },
  { name: 'tecnico evidencia', path: '/tecnico/servicio/1/evidencia', role: 'tecnico' },
  { name: 'tecnico inventario', path: '/tecnico/inventario', role: 'tecnico' },
  { name: 'tecnico perfil', path: '/tecnico/perfil', role: 'tecnico' },
  { name: 'tecnico refacciones', path: '/tecnico/servicio/1/refacciones', role: 'tecnico' },
]

function startErrorCapture(page: Page) {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Failed to load resource: the server responded with a status of 404')) return
    errors.push(text)
  })

  page.on('pageerror', (error) => {
    errors.push(error.message)
  })

  return errors
}

async function expectHealthyScreen(page: Page, route: SmokeRoute, errors: string[]) {
  await page.goto(route.path)
  await page.waitForLoadState('domcontentloaded')

  if (route.expectedPath) {
    await expect(page).toHaveURL(route.expectedPath)
  } else {
    await expect(page).toHaveURL(new RegExp(`${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  }

  await expect(page.locator('body')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(
    /Faltan variables de entorno|No se encontró perfil|Unauthorized|Forbidden|No hay datos locales|Application error/i,
  )
  await expect(page.locator('body')).not.toContainText(
    /Validando tu sesión|Cargando aplicación|Estamos preparando la interfaz/i,
    { timeout: 10_000 },
  )
  expect(errors, `console/page errors while loading ${route.name}`).toEqual([])
}

test.describe('auth shell', () => {
  test('shows login and signs in with mocked Supabase auth', async ({ page }) => {
    const errors = startErrorCapture(page)
    await installSupabaseMock(page, { authenticated: false, role: 'admin' })

    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /iniciar sesión/i })).toBeVisible()
    await page.getByLabel(/correo/i).fill('admin@ran.test')
    await page.getByLabel(/contraseña/i).fill('Admin123!')
    await page.getByRole('button', { name: /ingresar/i }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(errors).toEqual([])
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    const errors = startErrorCapture(page)
    await installSupabaseMock(page, { authenticated: false, role: 'admin' })

    await page.goto('/servicios')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: /iniciar sesión/i })).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('admin smoke screens', () => {
  for (const route of adminRoutes) {
    test(route.name, async ({ page }) => {
      const errors = startErrorCapture(page)
      await installSupabaseMock(page, { role: route.role })
      await expectHealthyScreen(page, route, errors)
    })
  }

  test('redirects admin away from tecnico shell', async ({ page }) => {
    const errors = startErrorCapture(page)
    await installSupabaseMock(page, { role: 'admin' })

    await page.goto('/tecnico')
    await expect(page).toHaveURL(/\/$/)
    expect(errors).toEqual([])
  })

  test('downloads the maintenance evidence ZIP completely', async ({ page }) => {
    const errors = startErrorCapture(page)
    await page.clock.setFixedTime(new Date('2026-04-26T12:00:00-06:00'))
    await installSupabaseMock(page, { role: 'admin' })

    await page.goto('/servicios')
    await expect(page.getByRole('heading', { name: 'Servicios' })).toBeVisible()
    await page.getByRole('button', { name: 'Exportar' }).click()
    await page.getByRole('menuitem', { name: /Mantenimientos/ }).hover()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Solo evidencias' }).click()
    const download = await downloadPromise
    const downloadPath = await download.path()

    expect(download.suggestedFilename()).toBe('S1726_Mantenimientos_SoloEvidencias_ReporteSemanal.zip')
    expect(await download.failure()).toBeNull()
    expect(downloadPath).not.toBeNull()
    expect(fs.statSync(downloadPath!).size).toBeGreaterThan(1024)
    expect(errors).toEqual([])
  })
})

test.describe('tecnico smoke screens', () => {
  for (const route of tecnicoRoutes) {
    test(route.name, async ({ page }) => {
      const errors = startErrorCapture(page)
      await installSupabaseMock(page, { role: route.role })
      await expectHealthyScreen(page, route, errors)
    })
  }

  test('tecnico home only renders today en ruta services and today completed services', async ({ page }) => {
    const errors = startErrorCapture(page)
    await page.clock.setFixedTime(new Date('2026-04-26T12:00:00-06:00'))
    await installSupabaseMock(page, { role: 'tecnico' })

    await page.goto('/tecnico')
    await expect(page.getByRole('heading', { name: 'En ruta' })).toBeVisible()
    await expect(page.getByText('Cliente Demo').first()).toBeVisible()
    await expect(page.getByText('Cliente Completado Hoy')).toBeVisible()
    await expect(page.getByText('Cliente Pendiente Hoy')).toHaveCount(0)
    await expect(page.getByText('Cliente En Ruta Otro Día')).toHaveCount(0)
    await expect(page.getByText('Cliente Completado Otro Día')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('redirects tecnico away from admin shell', async ({ page }) => {
    const errors = startErrorCapture(page)
    await installSupabaseMock(page, { role: 'tecnico' })

    await page.goto('/servicios')
    await expect(page).toHaveURL(/\/tecnico$/)
    expect(errors).toEqual([])
  })
})
