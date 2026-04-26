import { Building2, Cpu, Users } from 'lucide-react'
import {
  LiquidGlassSubNav,
  type LiquidGlassSubNavItem,
} from '@/components/shared/LiquidGlassSubNav'

const items: LiquidGlassSubNavItem[] = [
  {
    to: '/catalogos',
    label: 'Clientes',
    icon: Building2,
    end: true,
    isActive: (pathname) => pathname === '/catalogos' || pathname.startsWith('/catalogos/clientes'),
  },
  {
    to: '/catalogos/empleados',
    label: 'Empleados',
    icon: Users,
    isActive: (pathname) => (
      pathname === '/catalogos/empleados' ||
      pathname.startsWith('/catalogos/empleados/') ||
      pathname === '/catalogos/tecnicos' ||
      pathname.startsWith('/catalogos/tecnicos/')
    ),
  },
  { to: '/catalogos/maquinas', label: 'Máquinas', icon: Cpu },
]

export function CatalogosSubNav() {
  return <LiquidGlassSubNav items={items} memoryKey="catalogos" />
}
