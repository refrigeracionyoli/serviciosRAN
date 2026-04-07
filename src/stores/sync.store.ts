import { create } from 'zustand'

interface SyncState {
  pendingCount: number
  isSyncing: boolean
  lastSyncAt: Date | null
  isOnline: boolean
  setPendingCount: (n: number) => void
  setIsSyncing: (v: boolean) => void
  setLastSyncAt: (date: Date) => void
  setIsOnline: (v: boolean) => void
}

export const useSyncStore = create<SyncState>()((set) => ({
  pendingCount: 0,
  isSyncing: false,
  lastSyncAt: null,
  isOnline: navigator.onLine,
  setPendingCount: (n) => set({ pendingCount: n }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setLastSyncAt: (date) => set({ lastSyncAt: date }),
  setIsOnline: (v) => set({ isOnline: v }),
}))
