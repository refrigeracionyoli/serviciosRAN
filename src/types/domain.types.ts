// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'tecnico'

export type ServicioStatus = 'pendiente' | 'en_ruta' | 'completado' | 'cerrado'

export type TipoServicio =
  | 'MTTO CORRECTIVO RUTA'
  | 'MTTO CORRECTIVO PISO'
  | 'MTTO PREVENTIVO RUTA'
  | 'INSTALACION'
  | 'RETIRO'
  | 'GARANTIA'

export type ModeloMaquina = 'KM901' | 'MS1500' | 'SD1002' | 'KM1300'

export type MaquinaStatus = 'operando' | 'en_taller' | 'baja'

export type ClaseOrden = 'ZSM1' | 'ZSI2'

export type MantenimientoStatus = 'pendiente' | 'en_ruta' | 'realizado'

export type MovimientoTipo = 'entrada' | 'salida' | 'ajuste'

export type MaquinaTallerMovimientoAccion = 'entrada' | 'salida' | 'reubicacion' | 'nota'

export type MaquinaTallerStatus = 'en_taller' | 'reparada' | 'devuelta'

// ─────────────────────────────────────────────────────────────
// ENTIDADES PRINCIPALES
// ─────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  nombre: string
  correo: string
  telefono: string | null
  role: UserRole
  especialidad: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface Cliente {
  id: number
  codigo_cliente: string
  nombre: string
  direccion: string | null
  municipio: string | null
  telefono: string | null
  correo_contacto: string | null
  activo: boolean
  created_at: string
}

export interface Maquina {
  id: number
  serie: string
  modelo: ModeloMaquina
  cliente_id: number | null
  fecha_instalacion: string | null
  status: MaquinaStatus
  observaciones: string | null
  activo: boolean
  created_at: string
  // relaciones
  cliente?: Cliente
}

export interface Servicio {
  id: number
  orden: number | null
  aviso: number | null
  clase_orden: ClaseOrden | null
  tipo_servicio: TipoServicio
  cliente_id: number | null
  maquina_id: number | null
  tecnico_id: string | null
  descripcion: string | null
  fecha_solicitud: string | null
  fecha_servicio: string | null
  status: ServicioStatus
  costo_refacciones: number
  costo_mano_obra: number
  total: number
  created_at: string
  updated_at: string
  // relaciones
  cliente?: Cliente
  maquina?: Maquina
  tecnico?: Profile
}

export interface Cierre {
  id: number
  servicio_id: number
  aviso: number | null
  parte_objeto: string | null
  causa: string | null
  descripcion: string
  costo_total: number | null
  tecnico_id: string | null
  firma_receptor: string | null
  created_at: string
  // relaciones
  servicio?: Servicio
  tecnico?: Profile
}

export interface Poliza {
  id: number
  cliente_id: number
  maquina_id: number
  activa: boolean
  fecha_inicio: string
  observaciones: string | null
  created_at: string
  // relaciones
  cliente?: Cliente
  maquina?: Maquina
}

export type PolizaEstado = 'activa' | 'inactiva'

export interface PolizaEstadoHistorial {
  id: number
  poliza_id: number
  estado: PolizaEstado
  changed_at: string
  changed_by: string | null
  motivo: string | null
}

export interface MantenimientoPoliza {
  id: number
  poliza_id: number
  cliente_id: number
  maquina_id: number
  tecnico_id: string | null
  tipo_servicio: string
  descripcion: string | null
  fecha_visita: string | null
  status: MantenimientoStatus
  costo_refacciones: number
  costo_mano_obra: number
  total: number
  notas: string | null
  created_at: string
  // relaciones
  poliza?: Poliza
  cliente?: Cliente
  maquina?: Maquina
  tecnico?: Profile
}

export interface ItemInventario {
  id: number
  nombre: string
  descripcion: string | null
  stock_actual: number
  stock_minimo: number
  precio_unitario: number | null
  activo: boolean
  created_at: string
}

export interface ServicioRefaccion {
  id: number
  servicio_id: number | null
  mantenimiento_id: number | null
  inventario_id: number | null
  nombre_refaccion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export interface InventarioTecnico {
  id: number
  tecnico_id: string
  inventario_id: number
  cantidad: number
  fecha: string
  created_at: string
  // relaciones
  tecnico?: Profile
  item?: ItemInventario
}

export interface MovimientoInventario {
  id: number
  inventario_id: number
  tipo: MovimientoTipo
  cantidad: number
  motivo: string | null
  referencia_id: number | null
  usuario_id: string | null
  created_at: string
  // relaciones
  item?: ItemInventario
  usuario?: Profile
}

export interface MaquinaEnTaller {
  id: number
  maquina_id: number
  cliente_id: number | null
  servicio_id: number | null
  orden: number | null
  fecha_entrada: string
  fecha_salida: string | null
  diagnostico: string | null
  status: MaquinaTallerStatus
  created_at: string
  // relaciones
  maquina?: Maquina
  cliente?: Cliente
  servicio?: Servicio
}

export interface MaquinaTallerMovimiento {
  id: number
  maquina_id: number
  maquina_taller_id: number | null
  servicio_id: number | null
  orden_servicio: number | null
  accion: MaquinaTallerMovimientoAccion
  motivo: string
  origen: string | null
  destino: string | null
  detalle: string | null
  fecha_movimiento: string
  usuario_id: string | null
  created_at: string
  // relaciones
  maquina?: Maquina
  servicio?: Servicio
  usuario?: Profile
}

export interface Evidencia {
  id: number
  servicio_id: number
  r2_key: string
  r2_bucket: string
  filename: string
  mime_type: string
  size_bytes: number | null
  orden: number
  subida_por: string | null
  created_at: string
  // campo virtual — se llena con presigned URL
  downloadUrl?: string
}

export interface CatalogoPep {
  id: number
  gz: string
  codigo_pep: string
  nombre_pep: string
  tipo_servicio: string
  activo: boolean
}

// ─────────────────────────────────────────────────────────────
// TIPOS DE FILTROS
// ─────────────────────────────────────────────────────────────

export interface FiltrosServicio {
  status?: ServicioStatus | null
  tecnicoId?: string | null
  clienteId?: number | null
  fechaDesde?: string | null
  fechaHasta?: string | null
  tipoServicio?: TipoServicio | null
  search?: string | null
}
