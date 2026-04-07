import { create } from 'zustand'
import type { ServicioStatus, TipoServicio } from '@/types/domain.types'

interface FiltrosState {
  status: ServicioStatus | null
  tecnicoId: string | null
  clienteId: number | null
  fechaDesde: string | null
  fechaHasta: string | null
  tipoServicio: TipoServicio | null
  search: string | null
  setFiltro: <K extends keyof Omit<FiltrosState, 'setFiltro' | 'resetFiltros'>>(
    key: K,
    value: FiltrosState[K],
  ) => void
  resetFiltros: () => void
}

const initialState = {
  status: null,
  tecnicoId: null,
  clienteId: null,
  fechaDesde: null,
  fechaHasta: null,
  tipoServicio: null,
  search: null,
}

export const useFiltrosStore = create<FiltrosState>()((set) => ({
  ...initialState,
  setFiltro: (key, value) => set({ [key]: value }),
  resetFiltros: () => set(initialState),
}))
