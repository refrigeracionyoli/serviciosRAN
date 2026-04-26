import { create } from 'zustand'

interface SyncState {
  pendingCount: number
  failedCount: number
  conflictCount: number
  isSyncing: boolean
  lastSyncAt: Date | null
  isOnline: boolean
  authBlocked: boolean
  lastError: string | null
  setPendingCount: (n: number) => void
  setFailedCount: (n: number) => void
  setConflictCount: (n: number) => void
  setIsSyncing: (v: boolean) => void
  setLastSyncAt: (date: Date) => void
  setIsOnline: (v: boolean) => void
  setAuthBlocked: (v: boolean) => void
  setLastError: (message: string | null) => void
  reset: () => void
}

const INITIAL_SYNC_STATE = {
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  isSyncing: false,
  lastSyncAt: null,
  isOnline: navigator.onLine,
  authBlocked: false,
  lastError: null,
} as const

export const useSyncStore = create<SyncState>()((set) => ({
  ...INITIAL_SYNC_STATE,
  setPendingCount: (n) => set({ pendingCount: n }),
  setFailedCount: (n) => set({ failedCount: n }),
  setConflictCount: (n) => set({ conflictCount: n }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setLastSyncAt: (date) => set({ lastSyncAt: date }),
  setIsOnline: (v) => set({ isOnline: v }),
  setAuthBlocked: (v) => set({ authBlocked: v }),
  setLastError: (message) => set({ lastError: message }),
  reset: () => set(INITIAL_SYNC_STATE),
}))
