import Dexie, { type Table } from 'dexie'
import type { Servicio, Cliente, Maquina, ItemInventario } from '@/types/domain.types'

export class ServiciosRanDB extends Dexie {
  servicios!: Table<Servicio & { _synced?: boolean }>
  clientes!: Table<Cliente>
  maquinas!: Table<Maquina>
  inventario!: Table<ItemInventario>

  constructor() {
    super('servicios-ran')
    this.version(1).stores({
      servicios: '++id, tecnico_id, status, fecha_servicio, cliente_id, updated_at',
      clientes: 'id, codigo_cliente, nombre',
      maquinas: 'id, cliente_id, serie, modelo',
      inventario: 'id, nombre, activo',
    })
  }
}

export const db = new ServiciosRanDB()
