import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  collapsed: boolean
  width: number
  toggle: () => void
  setCollapsed: (v: boolean) => void
  setWidth: (width: number) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      width: 256,
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (v) => set({ collapsed: v }),
      setWidth: (width) => set({ width }),
    }),
    { name: 'ran-sidebar' },
  ),
)
