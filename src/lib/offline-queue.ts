import Dexie, { type Table } from 'dexie'

export interface QueuedMutation {
  id?: number
  table: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  payload: Record<string, unknown>
  rowId?: string | number
  createdAt: string
  retries: number
}

class OfflineQueueDB extends Dexie {
  mutations!: Table<QueuedMutation>

  constructor() {
    super('servicios-ran-queue')
    this.version(1).stores({
      mutations: '++id, table, operation, createdAt',
    })
  }
}

const queueDb = new OfflineQueueDB()

export const offlineQueue = {
  async add(mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'retries'>) {
    await queueDb.mutations.add({
      ...mutation,
      createdAt: new Date().toISOString(),
      retries: 0,
    })
  },

  async getAll(): Promise<QueuedMutation[]> {
    return queueDb.mutations.orderBy('createdAt').toArray()
  },

  async remove(id: number) {
    await queueDb.mutations.delete(id)
  },

  async incrementRetry(id: number) {
    await queueDb.mutations.where('id').equals(id).modify((m) => {
      m.retries += 1
    })
  },

  async count(): Promise<number> {
    return queueDb.mutations.count()
  },

  async clear() {
    await queueDb.mutations.clear()
  },
}
