import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  FileCheck2,
  Package,
  Wrench,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSidebarStore } from '@/stores/sidebar.store'
import { useSignOut, useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'

interface NavItem {
  to: string
  label: string
  icon: React.ElementType
  exact?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/servicios', label: 'Servicios', icon: ClipboardList },
  { to: '/polizas', label: 'Pólizas', icon: FileCheck2 },
  { to: '/inventario', label: 'Inventario', icon: Package },
  { to: '/maquinas-taller', label: 'Taller', icon: Wrench },
  { to: '/reportes/semanal', label: 'Reportes', icon: BarChart3 },
  { to: '/catalogos', label: 'Catálogos', icon: Settings },
]

function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const isActive = item.exact
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to)

  const content = (
    <NavLink
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-semibold transition-all',
        'hover:bg-slate-100 hover:text-ran-navy',
        isActive
          ? 'bg-slate-200 text-ran-navy'
          : 'text-slate-500',
        collapsed && 'justify-center px-2',
      )}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    )
  }

  return content
}

export function Sidebar() {
  const { collapsed, width, toggle, setWidth } = useSidebarStore()
  const { mutate: signOut } = useSignOut()
  const { perfil } = useAuth()
  const isResizingRef = useRef(false)
  const latestWidthRef = useRef(width)
  const [liveWidth, setLiveWidth] = useState(width)
  const [isResizing, setIsResizing] = useState(false)

  const MIN_WIDTH = 220
  const MAX_WIDTH = 360
  const COLLAPSED_WIDTH = 74

  useEffect(() => {
    if (!isResizing) {
      setLiveWidth(width)
      latestWidthRef.current = width
    }
  }, [width, isResizing])

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isResizingRef.current = true
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, moveEvent.clientX))
      latestWidthRef.current = nextWidth
      setLiveWidth(nextWidth)
    }

    const onMouseUp = () => {
      isResizingRef.current = false
      setIsResizing(false)
      setWidth(latestWidthRef.current)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <aside
      className={cn(
        'group/sidebar relative flex flex-col border-r border-slate-200 bg-white',
        !isResizing && 'transition-[width] duration-200',
      )}
      style={{ width: collapsed ? COLLAPSED_WIDTH : liveWidth }}
    >
      {/* Logo / Header */}
      <div
        className={cn(
          'border-b border-slate-100',
          collapsed ? 'px-0 py-2' : 'flex h-16 items-center justify-between px-3',
        )}
      >
        {!collapsed && (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <img src="/icons/Ran_logo.png" alt="RAN Refrigeracion" className="h-8 w-8 shrink-0 rounded-md object-cover" />
              <p className="truncate text-sm font-bold leading-none text-slate-900">Servicios RAN</p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggle}
              className="h-7 w-7 p-0"
              title="Colapsar menú"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </>
        )}

        {collapsed && (
          <div className="flex flex-col items-center gap-2">
            <img src="/icons/Ran_logo.png" alt="RAN" className="h-8 w-8 rounded-md object-cover" />

            <Button
              variant="ghost"
              size="sm"
              onClick={toggle}
              className="h-7 w-7 p-0"
              title="Expandir menú"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {navItems.map((item) => (
          <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <Separator />

      {/* Footer: user + toggle + logout */}
      <div className="space-y-1 p-2">
        {!collapsed && perfil && (
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-ran-navy font-semibold text-sm">
              {perfil.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{perfil.nombre}</p>
              <p className="truncate text-xs capitalize text-slate-500">{perfil.role}</p>
            </div>
          </div>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut()}
              className={cn(
                'w-full text-ran-slate hover:text-destructive hover:bg-destructive/10',
                collapsed ? 'justify-center' : 'justify-start gap-2',
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Cerrar sesión</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Cerrar sesión</TooltipContent>}
        </Tooltip>
      </div>

      {!collapsed && (
        <div
          className="absolute inset-y-0 -right-[3px] z-20 w-2 cursor-col-resize opacity-0 transition-opacity group-hover/sidebar:opacity-100"
          onMouseDown={handleResizeStart}
          title="Redimensionar menú"
        />
      )}
    </aside>
  )
}

export function SidebarSubNav({ items }: { items: { to: string; label: string; icon?: React.ElementType }[] }) {
  return (
    <nav className="flex gap-1 border-b border-border px-6 pt-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
              isActive
                ? 'border-ran-navy text-ran-navy'
                : 'border-transparent text-ran-slate hover:text-ran-navy',
            )
          }
        >
          {item.icon && <item.icon className="h-4 w-4" />}
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

// Re-exportaciones para catálogos y reportes
export { Users }
