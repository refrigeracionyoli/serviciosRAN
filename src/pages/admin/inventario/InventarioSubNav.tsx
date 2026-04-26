import { Boxes, ClipboardList, UsersRound } from 'lucide-react'
import {
  LiquidGlassSubNav,
  type LiquidGlassSubNavItem,
} from '@/components/shared/LiquidGlassSubNav'

const items: LiquidGlassSubNavItem[] = [
  { to: '/inventario', label: 'Catálogo', icon: Boxes, end: true },
  { to: '/inventario/tecnico', label: 'Inventario por técnico', icon: UsersRound },
  { to: '/inventario/movimientos', label: 'Movimientos', icon: ClipboardList },
]

export function InventarioSubNav() {
  return <LiquidGlassSubNav items={items} memoryKey="inventario" />
}
