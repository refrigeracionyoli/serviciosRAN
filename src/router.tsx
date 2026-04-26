import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import {
  TecnicoEvidenciaSkeleton,
  TecnicoHomeSkeleton,
  TecnicoInventarioSkeleton,
  TecnicoPageLoadingSkeleton,
  TecnicoPerfilSkeleton,
  TecnicoRefaccionesSkeleton,
  TecnicoServicioDetalleSkeleton,
} from '@/components/shared/TecnicoSkeletons'
import { useAuth } from '@/hooks/use-auth'
import { AdminDashboardSkeleton, AdminPageLoadingSkeleton } from '@/components/shared/AdminSkeletons'
import { AuthLoader } from '@/components/shared/AuthLoader'
import { LoginPage } from '@/pages/auth/LoginPage'

// Layouts
import { AppLayout } from '@/components/layout/AppLayout'
import { MobileLayout } from '@/components/layout/MobileLayout'

// Lazy pages
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ServiciosPage = lazy(() => import('@/pages/admin/servicios/ServiciosPage').then((module) => ({ default: module.ServiciosPage })))
const ServicioNuevoPage = lazy(() => import('@/pages/admin/servicios/ServicioNuevoPage').then((module) => ({ default: module.ServicioNuevoPage })))
const ServicioEditarPage = lazy(() => import('@/pages/admin/servicios/ServicioEditarPage').then((module) => ({ default: module.ServicioEditarPage })))
const ServicioDetallePage = lazy(() => import('@/pages/admin/servicios/ServicioDetallePage').then((module) => ({ default: module.ServicioDetallePage })))
const PolizasPage = lazy(() => import('@/pages/admin/polizas/PolizasPage').then((module) => ({ default: module.PolizasPage })))
const PolizaNuevaPage = lazy(() => import('@/pages/admin/polizas/PolizaNuevaPage').then((module) => ({ default: module.PolizaNuevaPage })))
const PolizaDetallePage = lazy(() => import('@/pages/admin/polizas/PolizaDetallePage').then((module) => ({ default: module.PolizaDetallePage })))
const MantenimientosPage = lazy(() => import('@/pages/admin/polizas/MantenimientosPage').then((module) => ({ default: module.MantenimientosPage })))
const AsignarMantenimientoPage = lazy(() => import('@/pages/admin/polizas/AsignarMantenimientoPage').then((module) => ({ default: module.AsignarMantenimientoPage })))
const MantenimientoDetallePage = lazy(() => import('@/pages/admin/polizas/MantenimientoDetallePage').then((module) => ({ default: module.MantenimientoDetallePage })))
const InventarioPage = lazy(() => import('@/pages/admin/inventario/InventarioPage').then((module) => ({ default: module.InventarioPage })))
const InventarioTecnicoPage = lazy(() => import('@/pages/admin/inventario/InventarioTecnicoPage').then((module) => ({ default: module.InventarioTecnicoPage })))
const MovimientosPage = lazy(() => import('@/pages/admin/inventario/MovimientosPage').then((module) => ({ default: module.MovimientosPage })))
const MaquinasTallerPage = lazy(() => import('@/pages/admin/maquinas-taller/MaquinasTallerPage').then((module) => ({ default: module.MaquinasTallerPage })))
const CatalogosPage = lazy(() => import('@/pages/admin/catalogos/CatalogosPage').then((module) => ({ default: module.CatalogosPage })))
const ClienteNuevoPage = lazy(() => import('@/pages/admin/catalogos/ClienteNuevoPage').then((module) => ({ default: module.ClienteNuevoPage })))
const ClienteDetallePage = lazy(() => import('@/pages/admin/catalogos/ClienteDetallePage').then((module) => ({ default: module.ClienteDetallePage })))
const ClienteEditarPage = lazy(() => import('@/pages/admin/catalogos/ClienteEditarPage').then((module) => ({ default: module.ClienteEditarPage })))
const TecnicosPage = lazy(() => import('@/pages/admin/catalogos/TecnicosPage').then((module) => ({ default: module.TecnicosPage })))
const TecnicoNuevoPage = lazy(() => import('@/pages/admin/catalogos/TecnicoNuevoPage').then((module) => ({ default: module.TecnicoNuevoPage })))
const MaquinasPage = lazy(() => import('@/pages/admin/catalogos/MaquinasPage').then((module) => ({ default: module.MaquinasPage })))
const MaquinaHistorialPage = lazy(() => import('@/pages/admin/catalogos/MaquinaHistorialPage').then((module) => ({ default: module.MaquinaHistorialPage })))
const TecnicoHomePage = lazy(() => import('@/pages/tecnico/TecnicoHomePage').then((module) => ({ default: module.TecnicoHomePage })))
const TecnicoMantenimientoPage = lazy(() => import('@/pages/tecnico/TecnicoMantenimientoPage').then((module) => ({ default: module.TecnicoMantenimientoPage })))
const TecnicoServicioDetallePage = lazy(() => import('@/pages/tecnico/TecnicoServicioDetallePage').then((module) => ({ default: module.TecnicoServicioDetallePage })))
const TecnicoEvidenciaPage = lazy(() => import('@/pages/tecnico/TecnicoEvidenciaPage').then((module) => ({ default: module.TecnicoEvidenciaPage })))
const TecnicoInventarioPage = lazy(() => import('@/pages/tecnico/TecnicoInventarioPage').then((module) => ({ default: module.TecnicoInventarioPage })))
const TecnicoPerfilPage = lazy(() => import('@/pages/tecnico/TecnicoPerfilPage').then((module) => ({ default: module.TecnicoPerfilPage })))
const TecnicoRefaccionesPage = lazy(() => import('@/pages/tecnico/TecnicoRefaccionesPage').then((module) => ({ default: module.TecnicoRefaccionesPage })))

// ─── RequireRole guard ────────────────────────────────────────

function RequireRole({ role, children }: { role: 'admin' | 'tecnico'; children: ReactNode }) {
  const { user, perfil, isLoading } = useAuth()

  if (isLoading) {
    return <AuthLoader variant="responsive" fullScreen title="Validando tu sesión" description="Estamos dejando lista tu cuenta." />
  }

  if (!user) return <Navigate to="/login" replace />
  if (!perfil?.activo) return <Navigate to="/login" replace />
  if (perfil.role !== role) {
    return <Navigate to={perfil.role === 'admin' ? '/' : '/tecnico'} replace />
  }

  return <>{children}</>
}

function FullscreenRouteLoadingFallback() {
  return <AuthLoader variant="responsive" fullScreen title="Cargando aplicación" description="Estamos preparando la interfaz." />
}

function withFullscreenLazyBoundary(children: ReactNode) {
  return <Suspense fallback={<FullscreenRouteLoadingFallback />}>{children}</Suspense>
}

function withAdminLazyBoundary(children: ReactNode, options?: { dashboard?: boolean }) {
  return (
    <Suspense fallback={options?.dashboard ? <AdminDashboardSkeleton /> : <AdminPageLoadingSkeleton />}>
      {children}
    </Suspense>
  )
}

function withMobileLazyBoundary(children: ReactNode, fallback: ReactNode = <TecnicoPageLoadingSkeleton />) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}

// ─── Router ──────────────────────────────────────────────────

export const router = createBrowserRouter([
  { path: '/login', element: withFullscreenLazyBoundary(<LoginPage />) },

  // Admin routes (desktop)
  {
    element: (
      <RequireRole role="admin">
        <AppLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: withAdminLazyBoundary(<DashboardPage />, { dashboard: true }) },
      { path: 'servicios', element: withAdminLazyBoundary(<ServiciosPage />) },
      { path: 'servicios/nuevo', element: withAdminLazyBoundary(<ServicioNuevoPage />) },
      { path: 'servicios/:id', element: withAdminLazyBoundary(<ServicioDetallePage />) },
      { path: 'servicios/:id/editar', element: withAdminLazyBoundary(<ServicioEditarPage />) },
      { path: 'polizas', element: withAdminLazyBoundary(<PolizasPage />) },
      { path: 'polizas/nueva', element: withAdminLazyBoundary(<PolizaNuevaPage />) },
      { path: 'polizas/asignar-mantenimiento', element: withAdminLazyBoundary(<AsignarMantenimientoPage />) },
      { path: 'polizas/:id', element: withAdminLazyBoundary(<PolizaDetallePage />) },
      { path: 'polizas/mantenimientos', element: withAdminLazyBoundary(<MantenimientosPage />) },
      { path: 'polizas/mantenimientos/:id', element: withAdminLazyBoundary(<MantenimientoDetallePage />) },
      { path: 'inventario', element: withAdminLazyBoundary(<InventarioPage />) },
      { path: 'inventario/tecnico', element: withAdminLazyBoundary(<InventarioTecnicoPage />) },
      { path: 'inventario/movimientos', element: withAdminLazyBoundary(<MovimientosPage />) },
      { path: 'maquinas-taller', element: withAdminLazyBoundary(<MaquinasTallerPage />) },
      { path: 'catalogos', element: withAdminLazyBoundary(<CatalogosPage />) },
      { path: 'catalogos/clientes/nuevo', element: withAdminLazyBoundary(<ClienteNuevoPage />) },
      { path: 'catalogos/clientes/:id', element: withAdminLazyBoundary(<ClienteDetallePage />) },
      { path: 'catalogos/clientes/:id/editar', element: withAdminLazyBoundary(<ClienteEditarPage />) },
      { path: 'catalogos/empleados', element: withAdminLazyBoundary(<TecnicosPage />) },
      { path: 'catalogos/empleados/nuevo', element: withAdminLazyBoundary(<TecnicoNuevoPage />) },
      { path: 'catalogos/tecnicos', element: <Navigate to="/catalogos/empleados" replace /> },
      { path: 'catalogos/tecnicos/nuevo', element: <Navigate to="/catalogos/empleados/nuevo" replace /> },
      { path: 'catalogos/maquinas', element: withAdminLazyBoundary(<MaquinasPage />) },
      { path: 'catalogos/maquinas/:id/historial', element: withAdminLazyBoundary(<MaquinaHistorialPage />) },
    ],
  },

  // Tecnico routes (mobile)
  {
    element: (
      <RequireRole role="tecnico">
        <MobileLayout />
      </RequireRole>
    ),
    children: [
      { path: 'tecnico', element: withMobileLazyBoundary(<TecnicoHomePage />, <TecnicoHomeSkeleton />) },
      { path: 'tecnico/mantenimiento/:id', element: withMobileLazyBoundary(<TecnicoMantenimientoPage />, <TecnicoRefaccionesSkeleton />) },
      { path: 'tecnico/servicio/:id', element: withMobileLazyBoundary(<TecnicoServicioDetallePage />, <TecnicoServicioDetalleSkeleton />) },
      { path: 'tecnico/servicio/:id/evidencia', element: withMobileLazyBoundary(<TecnicoEvidenciaPage />, <TecnicoEvidenciaSkeleton />) },
      { path: 'tecnico/inventario', element: withMobileLazyBoundary(<TecnicoInventarioPage />, <TecnicoInventarioSkeleton />) },
      { path: 'tecnico/perfil', element: withMobileLazyBoundary(<TecnicoPerfilPage />, <TecnicoPerfilSkeleton />) },
      { path: 'tecnico/servicio/:id/refacciones', element: withMobileLazyBoundary(<TecnicoRefaccionesPage />, <TecnicoRefaccionesSkeleton />) },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/" replace /> },
])
