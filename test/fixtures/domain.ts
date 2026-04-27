import type {
  Cierre,
  Cliente,
  Evidencia,
  InventarioTecnico,
  ItemInventario,
  Maquina,
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  MantenimientoPoliza,
  MovimientoInventario,
  Poliza,
  Profile,
  Servicio,
  ServicioRefaccion,
} from '@/types/domain.types'
import type { OfflineCommandRecord, OfflineCommandType } from '@/lib/offline/db'

export const OWNER_ID = '11111111-1111-4111-8111-111111111111'
export const TECNICO_ID = '22222222-2222-4222-8222-222222222222'
export const ADMIN_ID = '33333333-3333-4333-8333-333333333333'

export function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: TECNICO_ID,
    nombre: 'Tecnico RAN',
    correo: 'tecnico@ran.test',
    telefono: '8112345678',
    role: 'tecnico',
    activo: true,
    created_at: '2026-04-20T12:00:00.000Z',
    updated_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  }
}

export function buildCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: 10,
    codigo_cliente: '12345',
    nombre: 'Six Centro',
    direccion: 'Av. Principal 123',
    municipio: 'Monterrey',
    telefono: '8111111111',
    correo_contacto: 'contacto@six.test',
    activo: true,
    created_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  }
}

export function buildMaquina(overrides: Partial<Maquina> = {}): Maquina {
  return {
    id: 20,
    serie: 'SER-001',
    modelo: 'KM901',
    cliente_id: 10,
    fecha_instalacion: '2026-04-01',
    status: 'operando',
    observaciones: null,
    activo: true,
    created_at: '2026-04-20T12:00:00.000Z',
    cliente: buildCliente(),
    ...overrides,
  }
}

export function buildServicio(overrides: Partial<Servicio> = {}): Servicio {
  return {
    id: 30,
    orden: 9001,
    aviso: 7001,
    clase_orden: 'ZSM1',
    tipo_servicio: 'MTTO PREVENTIVO RUTA',
    cliente_id: 10,
    maquina_id: 20,
    tecnico_id: TECNICO_ID,
    descripcion: 'Servicio preventivo programado',
    fecha_solicitud: '2026-04-20',
    fecha_servicio: '2026-04-26',
    fecha_cierre: null,
    status: 'en_ruta',
    costo_refacciones: 0,
    costo_mano_obra: 0,
    total: 0,
    created_at: '2026-04-20T12:00:00.000Z',
    updated_at: '2026-04-20T12:00:00.000Z',
    cliente: buildCliente(),
    maquina: buildMaquina(),
    tecnico: buildProfile(),
    ...overrides,
  }
}

export function buildEvidencia(overrides: Partial<Evidencia> = {}): Evidencia {
  return {
    id: 40,
    servicio_id: 30,
    r2_key: '30/evidencias/foto.jpg',
    r2_bucket: 'ran-evidencias',
    filename: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    orden: 1,
    subida_por: TECNICO_ID,
    created_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  }
}

export function buildInventarioItem(overrides: Partial<ItemInventario> = {}): ItemInventario {
  return {
    id: 50,
    nombre: 'Filtro',
    descripcion: 'Filtro de agua',
    stock_actual: 10,
    stock_minimo: 2,
    precio_unitario: 150,
    activo: true,
    created_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  }
}

export function buildServicioRefaccion(overrides: Partial<ServicioRefaccion> = {}): ServicioRefaccion {
  return {
    id: 60,
    servicio_id: 30,
    mantenimiento_id: null,
    inventario_id: 50,
    nombre_refaccion: 'Filtro',
    cantidad: 2,
    precio_unitario: 150,
    subtotal: 300,
    inventory_source: 'general',
    ...overrides,
  }
}

export function buildInventarioTecnico(overrides: Partial<InventarioTecnico> = {}): InventarioTecnico {
  return {
    id: 70,
    tecnico_id: TECNICO_ID,
    inventario_id: 50,
    cantidad: 3,
    cantidad_asignada_total: 3,
    fecha: '2026-04-26',
    created_at: '2026-04-20T12:00:00.000Z',
    devuelto_at: null,
    devuelto_automaticamente: false,
    tecnico: buildProfile(),
    item: buildInventarioItem(),
    ...overrides,
  }
}

export function buildMovimientoInventario(overrides: Partial<MovimientoInventario> = {}): MovimientoInventario {
  return {
    id: 80,
    inventario_id: 50,
    tipo: 'salida',
    cantidad: 1,
    motivo: '[SERVICIO:30] Instalacion a Six Centro',
    referencia_id: 30,
    usuario_id: TECNICO_ID,
    created_at: '2026-04-20T12:00:00.000Z',
    item: buildInventarioItem(),
    usuario: buildProfile(),
    ...overrides,
  }
}

export function buildPoliza(overrides: Partial<Poliza> = {}): Poliza {
  return {
    id: 90,
    cliente_id: 10,
    maquina_id: 20,
    activa: true,
    fecha_inicio: '2026-04-01',
    observaciones: null,
    created_at: '2026-04-20T12:00:00.000Z',
    cliente: buildCliente(),
    maquina: buildMaquina(),
    ...overrides,
  }
}

export function buildMantenimiento(overrides: Partial<MantenimientoPoliza> = {}): MantenimientoPoliza {
  return {
    id: 100,
    poliza_id: 90,
    cliente_id: 10,
    maquina_id: 20,
    tecnico_id: TECNICO_ID,
    tipo_servicio: 'MTTO PREVENTIVO RUTA',
    descripcion: 'Mantenimiento de póliza',
    fecha_visita: '2026-04-26',
    status: 'pendiente',
    costo_refacciones: 0,
    costo_mano_obra: 0,
    total: 0,
    notas: null,
    created_at: '2026-04-20T12:00:00.000Z',
    poliza: buildPoliza(),
    cliente: buildCliente(),
    maquina: buildMaquina(),
    tecnico: buildProfile(),
    ...overrides,
  }
}

export function buildCierre(overrides: Partial<Cierre> = {}): Cierre {
  return {
    id: 110,
    servicio_id: 30,
    aviso: 7001,
    parte_objeto: 'Compresor',
    causa: 'Mantenimiento',
    descripcion: 'Servicio cerrado con evidencia completa',
    costo_total: 300,
    tecnico_id: TECNICO_ID,
    firma_receptor: 'Encargado',
    created_at: '2026-04-20T12:00:00.000Z',
    servicio: buildServicio(),
    tecnico: buildProfile(),
    ...overrides,
  }
}

export function buildMaquinaTaller(overrides: Partial<MaquinaEnTaller> = {}): MaquinaEnTaller {
  return {
    id: 120,
    maquina_id: 20,
    cliente_id: 10,
    servicio_id: 30,
    orden: 9001,
    fecha_entrada: '2026-04-20',
    fecha_salida: null,
    diagnostico: 'Retiro',
    status: 'en_taller',
    created_at: '2026-04-20T12:00:00.000Z',
    maquina: buildMaquina(),
    cliente: buildCliente(),
    servicio: buildServicio(),
    ...overrides,
  }
}

export function buildMaquinaTallerMovimiento(overrides: Partial<MaquinaTallerMovimiento> = {}): MaquinaTallerMovimiento {
  return {
    id: 130,
    maquina_id: 20,
    maquina_taller_id: 120,
    servicio_id: 30,
    orden_servicio: 9001,
    accion: 'entrada',
    motivo: 'retiro',
    origen: 'cliente',
    destino: 'taller',
    detalle: 'Entrada por retiro',
    fecha_movimiento: '2026-04-20',
    usuario_id: TECNICO_ID,
    created_at: '2026-04-20T12:00:00.000Z',
    maquina: buildMaquina(),
    servicio: buildServicio(),
    usuario: buildProfile(),
    ...overrides,
  }
}

export function buildOfflineCommand(
  overrides: Partial<OfflineCommandRecord> & { type?: OfflineCommandType } = {},
): OfflineCommandRecord {
  return {
    id: 'cmd_test',
    ownerId: OWNER_ID,
    type: 'servicio.update',
    status: 'pending',
    payload: {},
    entityType: 'servicio',
    entityId: '30',
    localOnlyId: null,
    createdAt: '2026-04-20T12:00:00.000Z',
    updatedAt: '2026-04-20T12:00:00.000Z',
    retryCount: 0,
    lastError: null,
    idempotencyKey: 'idem_test',
    dependsOn: [],
    ...overrides,
  }
}
