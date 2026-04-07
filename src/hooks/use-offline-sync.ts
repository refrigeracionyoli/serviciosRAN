import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { offlineQueue } from '@/lib/offline-queue'
import { supabase } from '@/lib/supabase'
import { useSyncStore } from '@/stores/sync.store'

export function useOfflineSync() {
  const qc = useQueryClient()
  const { setIsOnline, setIsSyncing, setPendingCount, setLastSyncAt } = useSyncStore()

  // Actualizar pendingCount periódicamente
  useEffect(() => {
    const updateCount = async () => {
      const count = await offlineQueue.count()
      setPendingCount(count)
    }
    updateCount()
    const interval = setInterval(updateCount, 5000)
    return () => clearInterval(interval)
  }, [setPendingCount])

  // Escuchar cambios de conectividad
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true)
      await drainQueue()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setIsOnline])

  async function drainQueue() {
    const mutations = await offlineQueue.getAll()
    if (mutations.length === 0) return

    setIsSyncing(true)

    for (const mutation of mutations) {
      try {
        if (mutation.operation === 'INSERT') {
          const { error } = await supabase.from(mutation.table).insert(mutation.payload)
          if (error) throw error
        } else if (mutation.operation === 'UPDATE' && mutation.rowId) {
          const { error } = await supabase
            .from(mutation.table)
            .update(mutation.payload)
            .eq('id', mutation.rowId)
          if (error) throw error
        } else if (mutation.operation === 'DELETE' && mutation.rowId) {
          const { error } = await supabase
            .from(mutation.table)
            .delete()
            .eq('id', mutation.rowId)
          if (error) throw error
        }

        if (mutation.id !== undefined) {
          await offlineQueue.remove(mutation.id)
        }
      } catch {
        if (mutation.id !== undefined) {
          await offlineQueue.incrementRetry(mutation.id)
        }
      }
    }

    const remaining = await offlineQueue.count()
    setPendingCount(remaining)
    setIsSyncing(false)
    setLastSyncAt(new Date())

    // Invalidar todas las queries para refrescar datos
    qc.invalidateQueries()
  }
}
