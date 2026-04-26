import { FileCheck2, Wrench } from 'lucide-react'
import {
  LiquidGlassSubNav,
  type LiquidGlassSubNavItem,
} from '@/components/shared/LiquidGlassSubNav'

const items: LiquidGlassSubNavItem[] = [
  { to: '/polizas', label: 'Sucursales en póliza', icon: FileCheck2, end: true },
  { to: '/polizas/mantenimientos', label: 'Mantenimientos', icon: Wrench },
]

export function PolizasSubNav() {
  return <LiquidGlassSubNav items={items} memoryKey="polizas" />
}
