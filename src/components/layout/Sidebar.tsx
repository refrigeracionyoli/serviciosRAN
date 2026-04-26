import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  FileCheck2,
  Package,
  Wrench,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ProfileSettingsPanel } from '@/components/profile/ProfileSettingsPanel'
import { cn } from '@/lib/utils'
import { useSidebarStore } from '@/stores/sidebar.store'
import { useSignOut, useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  const [profileOpen, setProfileOpen] = useState(false)

  const MIN_WIDTH = 220
  const MAX_WIDTH = 360
  const COLLAPSED_WIDTH = 74
  const toggleLabel = collapsed ? 'Expandir menú' : 'Colapsar menú'

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
      <div className="relative flex h-16 items-center border-b border-slate-100 px-3">
        <div className={cn('flex min-w-0 items-center gap-2', collapsed ? 'mx-auto' : 'pr-8')}>
          <img src="/icons/Ran_logo.png" alt="RAN Refrigeracion" className="h-8 w-8 shrink-0 rounded-md object-cover" />
          {!collapsed && <p className="truncate text-sm font-bold leading-none text-slate-900">Servicios RAN</p>}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={toggle}
              aria-label={toggleLabel}
              className={cn(
                'absolute right-0 top-1/2 z-30 h-8 w-8 -translate-y-1/2 translate-x-1/2 rounded-full border-slate-200 bg-white text-slate-500 shadow-sm',
                'hover:bg-slate-50 hover:text-ran-navy',
              )}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
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
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-ran-navy font-semibold text-sm">
              {perfil.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{perfil.nombre}</p>
              <p className="truncate text-xs capitalize text-slate-500">{perfil.role}</p>
            </div>
          </button>
        )}

        {collapsed && perfil && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setProfileOpen(true)}
                className="h-11 w-full justify-center rounded-xl px-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-ran-navy">
                  {perfil.nombre.charAt(0).toUpperCase()}
                </div>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Mi perfil</TooltipContent>
          </Tooltip>
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

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle className="text-ran-navy">Mi perfil</DialogTitle>
            <DialogDescription>
              Administra tu información general y la seguridad de tu cuenta.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(85vh-88px)] overflow-y-auto px-6 py-5">
            <ProfileSettingsPanel variant="dialog" />
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

export function SidebarSubNav({ items }: { items: Array<{ to: string; label: string; icon?: React.ElementType }> }) {
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

// Re-exportación para catálogos
export { Users }
