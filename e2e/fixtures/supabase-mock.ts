import type { Page, Route } from '@playwright/test'

export type E2ERole = 'admin' | 'tecnico'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://e2e.supabase.co'
const SUPABASE_HOST = new URL(SUPABASE_URL).host
const SUPABASE_REF = SUPABASE_HOST.split('.')[0]
const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const TECNICO_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-04-26T12:00:00.000Z'
const TODAY = '2026-04-26'

interface SupabaseMockOptions {
  role?: E2ERole
  authenticated?: boolean
}

function base64Url(input: object) {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function userIdForRole(role: E2ERole) {
  return role === 'admin' ? ADMIN_ID : TECNICO_ID
}

function emailForRole(role: E2ERole) {
  return role === 'admin' ? 'admin@ran.test' : 'tecnico@ran.test'
}

function createAccessToken(role: E2ERole) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60
  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url({
      aud: 'authenticated',
      exp,
      sub: userIdForRole(role),
      email: emailForRole(role),
      role: 'authenticated',
      app_metadata: {},
      user_metadata: { role },
    }),
    'e2e-signature',
  ].join('.')
}

function createUser(role: E2ERole) {
  return {
    id: userIdForRole(role),
    aud: 'authenticated',
    role: 'authenticated',
    email: emailForRole(role),
    phone: '',
    app_metadata: {},
    user_metadata: { role },
    identities: [],
    created_at: NOW,
    updated_at: NOW,
  }
}

function createSession(role: E2ERole) {
  return {
    access_token: createAccessToken(role),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `${role}-refresh-token`,
    user: createUser(role),
  }
}

const adminProfile = {
  id: ADMIN_ID,
  nombre: 'Admin RAN',
  correo: emailForRole('admin'),
  telefono: '8111111111',
  role: 'admin',
  activo: true,
  created_at: NOW,
  updated_at: NOW,
}

const tecnicoProfile = {
  id: TECNICO_ID,
  nombre: 'Tecnico RAN',
  correo: emailForRole('tecnico'),
  telefono: '8122222222',
  role: 'tecnico',
  activo: true,
  created_at: NOW,
  updated_at: NOW,
}

const cliente = {
  id: 1,
  codigo_cliente: 'CLI-001',
  nombre: 'Cliente Demo',
  direccion: 'Av. Demo 100',
  municipio: 'Monterrey',
  telefono: '8180000000',
  correo_contacto: 'cliente@demo.test',
  activo: true,
  created_at: NOW,
}

const maquina = {
  id: 1,
  serie: 'RAN-ICE-001',
  modelo: 'Hielo Demo 500',
  cliente_id: cliente.id,
  fecha_instalacion: '2026-01-10',
  status: 'operando',
  observaciones: 'Maquina de prueba E2E',
  activo: true,
  created_at: NOW,
  cliente,
}

const inventarioItem = {
  id: 1,
  nombre: 'Filtro de agua',
  descripcion: 'Refaccion demo',
  stock_actual: 12,
  stock_minimo: 2,
  precio_unitario: 350,
  activo: true,
  created_at: NOW,
}

const servicio = {
  id: 1,
  orden: 1001,
  aviso: 2001,
  clase_orden: 'ZSM1',
  tipo_servicio: 'MTTO CORRECTIVO RUTA',
  cliente_id: cliente.id,
  maquina_id: maquina.id,
  tecnico_id: TECNICO_ID,
  descripcion: 'Servicio de prueba E2E',
  fecha_solicitud: TODAY,
  fecha_servicio: TODAY,
  fecha_cierre: null,
  status: 'en_ruta',
  costo_refacciones: 350,
  costo_mano_obra: 500,
  total: 850,
  created_at: NOW,
  updated_at: NOW,
  cliente,
  maquina,
  tecnico: tecnicoProfile,
}

const cierre = {
  id: 1,
  servicio_id: servicio.id,
  aviso: servicio.aviso,
  parte_objeto: 'Sistema de agua',
  causa: 'Mantenimiento preventivo',
  descripcion: 'Cierre de prueba',
  costo_total: servicio.total,
  tecnico_id: TECNICO_ID,
  firma_receptor: null,
  created_at: NOW,
  servicio,
  tecnico: tecnicoProfile,
}

const evidencia = {
  id: 1,
  servicio_id: servicio.id,
  r2_key: '1/evidencias/demo.jpg',
  r2_bucket: 'ran-evidencias',
  filename: 'demo.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 1024,
  orden: 1,
  subida_por: TECNICO_ID,
  created_at: NOW,
}

const poliza = {
  id: 1,
  cliente_id: cliente.id,
  maquina_id: maquina.id,
  activa: true,
  fecha_inicio: '2026-01-01',
  observaciones: 'Poliza demo',
  created_at: NOW,
  cliente,
  maquina,
}

const mantenimiento = {
  id: 1,
  poliza_id: poliza.id,
  cliente_id: cliente.id,
  maquina_id: maquina.id,
  tecnico_id: TECNICO_ID,
  tipo_servicio: 'MTTO PREVENTIVO RUTA',
  descripcion: 'Mantenimiento demo',
  fecha_visita: TODAY,
  status: 'en_ruta',
  costo_refacciones: 0,
  costo_mano_obra: 0,
  total: 0,
  notas: null,
  created_at: NOW,
  poliza,
  cliente,
  maquina,
  tecnico: tecnicoProfile,
}

const servicioRefaccion = {
  id: 1,
  servicio_id: servicio.id,
  mantenimiento_id: null,
  inventario_id: inventarioItem.id,
  nombre_refaccion: inventarioItem.nombre,
  cantidad: 1,
  precio_unitario: 350,
  subtotal: 350,
  inventory_source: 'general',
}

const mantenimientoRefaccion = {
  ...servicioRefaccion,
  id: 2,
  servicio_id: null,
  mantenimiento_id: mantenimiento.id,
}

const inventarioTecnico = {
  id: 1,
  tecnico_id: TECNICO_ID,
  inventario_id: inventarioItem.id,
  cantidad: 2,
  cantidad_asignada_total: 2,
  fecha: TODAY,
  created_at: NOW,
  devuelto_at: null,
  devuelto_automaticamente: false,
  tecnico: tecnicoProfile,
  item: inventarioItem,
}

const movimientoInventario = {
  id: 1,
  inventario_id: inventarioItem.id,
  tipo: 'entrada',
  cantidad: 12,
  motivo: 'Carga inicial E2E',
  referencia_id: null,
  usuario_id: ADMIN_ID,
  created_at: NOW,
  item: inventarioItem,
  usuario: adminProfile,
}

const maquinaTaller = {
  id: 1,
  maquina_id: maquina.id,
  cliente_id: cliente.id,
  servicio_id: servicio.id,
  orden: servicio.orden,
  fecha_entrada: TODAY,
  fecha_salida: null,
  diagnostico: 'Revision demo',
  status: 'en_taller',
  created_at: NOW,
  maquina,
  cliente,
  servicio,
}

const maquinaTallerMovimiento = {
  id: 1,
  maquina_id: maquina.id,
  maquina_taller_id: maquinaTaller.id,
  servicio_id: servicio.id,
  orden_servicio: servicio.orden,
  accion: 'entrada',
  motivo: 'Ingreso demo',
  origen: 'Cliente',
  destino: 'Taller',
  detalle: 'Movimiento E2E',
  fecha_movimiento: TODAY,
  usuario_id: ADMIN_ID,
  created_at: NOW,
  maquina,
  servicio,
  usuario: adminProfile,
}

const polizaHistorial = {
  id: 1,
  poliza_id: poliza.id,
  estado: 'activa',
  changed_at: NOW,
  changed_by: ADMIN_ID,
  motivo: 'Alta inicial',
}

const polizaPausa = {
  id: 1,
  fecha_inicio: '2026-03-01',
  fecha_reanudacion: null,
  motivo: 'Pausa demo',
  created_at: NOW,
  created_by: ADMIN_ID,
  resumed_at: null,
  resumed_by: null,
}

const catalogoPep = {
  id: 1,
  gz: 'GZ01',
  codigo_pep: 'PEP-001',
  nombre_pep: 'PEP Demo',
  tipo_servicio: 'MTTO CORRECTIVO RUTA',
  activo: true,
}

const tableRows: Record<string, Array<Record<string, unknown>>> = {
  profiles: [adminProfile, tecnicoProfile],
  clientes: [cliente],
  maquinas: [maquina],
  servicios: [servicio],
  cierres: [cierre],
  evidencias: [evidencia],
  inventario: [inventarioItem],
  inventario_tecnico: [inventarioTecnico],
  movimientos_inventario: [movimientoInventario],
  polizas: [poliza],
  poliza_estado_historial: [polizaHistorial],
  poliza_pausas: [polizaPausa],
  mantenimientos_poliza: [mantenimiento],
  servicio_refacciones: [servicioRefaccion, mantenimientoRefaccion],
  maquinas_en_taller: [maquinaTaller],
  maquinas_taller_movimientos: [maquinaTallerMovimiento],
  catalogo_pep: [catalogoPep],
}

function responseHeaders(extra?: Record<string, string>) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    ...extra,
  }
}

function parseComparableValue(value: string) {
  if (value === 'null') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return decodeURIComponent(value)
}

function applyPostgrestFilters(rows: Array<Record<string, unknown>>, url: URL) {
  const ignored = new Set(['select', 'order', 'limit', 'offset', 'or'])

  return rows.filter((row) => {
    for (const [key, value] of url.searchParams) {
      if (ignored.has(key)) continue

      if (value.startsWith('eq.')) {
        const expected = parseComparableValue(value.slice(3))
        if (row[key] !== expected) return false
      }

      if (value === 'is.null' && row[key] !== null) return false
      if (value === 'not.is.null' && row[key] === null) return false
      if (value.startsWith('gte.') && String(row[key] ?? '') < value.slice(4)) return false
      if (value.startsWith('lte.') && String(row[key] ?? '') > value.slice(4)) return false
      if (value.startsWith('ilike.')) {
        const needle = value.slice(6).replace(/%/g, '').toLowerCase()
        if (!String(row[key] ?? '').toLowerCase().includes(needle)) return false
      }
    }

    return true
  })
}

function isObjectResponse(route: Route) {
  const accept = route.request().headers().accept ?? ''
  return accept.includes('application/vnd.pgrst.object+json')
}

function rowsForTable(tableName: string, role: E2ERole) {
  const rows = tableRows[tableName] ?? []
  if (role === 'tecnico' && tableName === 'servicios') {
    return rows.filter((row) => row.tecnico_id === TECNICO_ID)
  }
  if (role === 'tecnico' && tableName === 'mantenimientos_poliza') {
    return rows.filter((row) => row.tecnico_id === TECNICO_ID)
  }
  if (role === 'tecnico' && tableName === 'inventario_tecnico') {
    return rows.filter((row) => row.tecnico_id === TECNICO_ID)
  }
  return rows
}

async function fulfillRest(route: Route, role: E2ERole, url: URL) {
  const tableName = url.pathname.replace('/rest/v1/', '').split('/')[0]

  if (tableName === 'rpc') {
    await route.fulfill({
      status: 200,
      headers: responseHeaders(),
      body: JSON.stringify({ success: true }),
    })
    return
  }

  if (route.request().method() !== 'GET') {
    const fallbackRow = rowsForTable(tableName, role)[0] ?? { id: 1 }
    await route.fulfill({
      status: 200,
      headers: responseHeaders(),
      body: JSON.stringify(isObjectResponse(route) ? fallbackRow : [fallbackRow]),
    })
    return
  }

  const rows = applyPostgrestFilters(rowsForTable(tableName, role), url)
  const body = isObjectResponse(route)
    ? rows[0] ?? null
    : rows

  await route.fulfill({
    status: 200,
    headers: responseHeaders({
      'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
    }),
    body: JSON.stringify(body),
  })
}

async function fulfillAuth(route: Route, role: E2ERole, url: URL) {
  const path = url.pathname

  if (path.endsWith('/token')) {
    await route.fulfill({
      status: 200,
      headers: responseHeaders(),
      body: JSON.stringify(createSession(role)),
    })
    return
  }

  if (path.endsWith('/user')) {
    await route.fulfill({
      status: 200,
      headers: responseHeaders(),
      body: JSON.stringify(createUser(role)),
    })
    return
  }

  if (path.endsWith('/logout')) {
    await route.fulfill({ status: 204, headers: responseHeaders() })
    return
  }

  await route.fulfill({
    status: 200,
    headers: responseHeaders(),
    body: JSON.stringify({}),
  })
}

async function fulfillFunction(route: Route, role: E2ERole, url: URL) {
  const functionName = url.pathname.replace('/functions/v1/', '')
  const bodyByFunction: Record<string, unknown> = {
    'admin-create-tecnico': { profile: tecnicoProfile },
    'admin-reset-empleado-password': { success: true },
    'r2-upload': { r2Key: '1/evidencias/e2e-upload.jpg' },
    'r2-presigned-put': { uploadUrl: 'https://r2.local/upload', r2Key: '1/evidencias/e2e-upload.jpg' },
    'r2-presigned-get': { downloadUrl: 'https://r2.local/download' },
    'r2-delete': { success: true, evidenciaId: 1 },
  }

  await route.fulfill({
    status: 200,
    headers: responseHeaders(),
    body: JSON.stringify(bodyByFunction[functionName] ?? { role, success: true }),
  })
}

export async function installSupabaseMock(page: Page, options: SupabaseMockOptions = {}) {
  const role = options.role ?? 'admin'
  const authenticated = options.authenticated ?? true
  const session = createSession(role)

  await page.addInitScript(({ storageKey, sessionPayload, shouldAuthenticate }) => {
    window.localStorage.clear()
    window.sessionStorage.clear()

    if (shouldAuthenticate) {
      window.localStorage.setItem(storageKey, JSON.stringify(sessionPayload))
    }

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      binaryType: BinaryType = 'blob'
      bufferedAmount = 0
      extensions = ''
      protocol = ''
      readyState = MockWebSocket.OPEN
      url: string
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null

      constructor(url: string) {
        super()
        this.url = url
        window.setTimeout(() => {
          const event = new Event('open')
          this.onopen?.(event)
          this.dispatchEvent(event)
        }, 0)
      }

      send() {
        return undefined
      }

      close() {
        this.readyState = MockWebSocket.CLOSED
        const event = new CloseEvent('close')
        this.onclose?.(event)
        this.dispatchEvent(event)
      }
    }

    window.WebSocket = MockWebSocket as typeof WebSocket
  }, {
    storageKey: STORAGE_KEY,
    sessionPayload: session,
    shouldAuthenticate: authenticated,
  })

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.startsWith('/auth/v1/')) {
      await fulfillAuth(route, role, url)
      return
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      await fulfillRest(route, role, url)
      return
    }

    if (url.pathname.startsWith('/functions/v1/')) {
      await fulfillFunction(route, role, url)
      return
    }

    await route.fulfill({
      status: 200,
      headers: responseHeaders(),
      body: JSON.stringify({}),
    })
  })
}
