import { type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

// Layouts
import { AppLayout } from '@/components/layout/AppLayout'
import { MobileLayout } from '@/components/layout/MobileLayout'

// Auth
import { LoginPage } from '@/pages/auth/LoginPage'

// Admin pages
import { DashboardPage } from '@/pages/admin/DashboardPage'
import { ServiciosPage } from '@/pages/admin/servicios/ServiciosPage'
import { ServicioNuevoPage } from '@/pages/admin/servicios/ServicioNuevoPage'
import { ServicioEditarPage } from '@/pages/admin/servicios/ServicioEditarPage'
import { ServicioDetallePage } from '@/pages/admin/servicios/ServicioDetallePage'
import { PolizasPage } from '@/pages/admin/polizas/PolizasPage'
import { PolizaNuevaPage } from '@/pages/admin/polizas/PolizaNuevaPage'
import { PolizaDetallePage } from '@/pages/admin/polizas/PolizaDetallePage'
import { MantenimientosPage } from '@/pages/admin/polizas/MantenimientosPage'
import { AsignarMantenimientoPage } from '@/pages/admin/polizas/AsignarMantenimientoPage'
import { MantenimientoDetallePage } from '@/pages/admin/polizas/MantenimientoDetallePage'
import { InventarioPage } from '@/pages/admin/inventario/InventarioPage'
import { InventarioTecnicoPage } from '@/pages/admin/inventario/InventarioTecnicoPage'
import { MovimientosPage } from '@/pages/admin/inventario/MovimientosPage'
import { MaquinasTallerPage } from '@/pages/admin/maquinas-taller/MaquinasTallerPage'
import { ReporteSemanalPage } from '@/pages/admin/reportes/ReporteSemanalPage'
import { EvidenciaPage } from '@/pages/admin/reportes/EvidenciaPage'
import { CatalogosPage } from '@/pages/admin/catalogos/CatalogosPage'
import { TecnicosPage } from '@/pages/admin/catalogos/TecnicosPage'
import { MaquinasPage } from '@/pages/admin/catalogos/MaquinasPage'
import { MaquinaHistorialPage } from '@/pages/admin/catalogos/MaquinaHistorialPage'

// Tecnico pages
import { TecnicoHomePage } from '@/pages/tecnico/TecnicoHomePage'
import { TecnicoEvidenciaPage } from '@/pages/tecnico/TecnicoEvidenciaPage'
import { TecnicoInventarioPage } from '@/pages/tecnico/TecnicoInventarioPage'
import { TecnicoRefaccionesPage } from '@/pages/tecnico/TecnicoRefaccionesPage'

// ─── RequireRole guard ────────────────────────────────────────

function RequireRole({ role, children }: { role: 'admin' | 'tecnico'; children: ReactNode }) {
  const { user, perfil, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (!perfil?.activo) return <Navigate to="/login" replace />
  if (perfil.role !== role) {
    return <Navigate to={perfil.role === 'admin' ? '/' : '/tecnico'} replace />
  }

  return <>{children}</>
}

// ─── Router ──────────────────────────────────────────────────

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },

  // Admin routes (desktop)
  {
    element: (
      <RequireRole role="admin">
        <AppLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'servicios', element: <ServiciosPage /> },
      { path: 'servicios/nuevo', element: <ServicioNuevoPage /> },
      { path: 'servicios/:id', element: <ServicioDetallePage /> },
      { path: 'servicios/:id/editar', element: <ServicioEditarPage /> },
      { path: 'polizas', element: <PolizasPage /> },
      { path: 'polizas/nueva', element: <PolizaNuevaPage /> },
      { path: 'polizas/asignar-mantenimiento', element: <AsignarMantenimientoPage /> },
      { path: 'polizas/:id', element: <PolizaDetallePage /> },
      { path: 'polizas/mantenimientos', element: <MantenimientosPage /> },
      { path: 'polizas/mantenimientos/:id', element: <MantenimientoDetallePage /> },
      { path: 'inventario', element: <InventarioPage /> },
      { path: 'inventario/tecnico', element: <InventarioTecnicoPage /> },
      { path: 'inventario/movimientos', element: <MovimientosPage /> },
      { path: 'maquinas-taller', element: <MaquinasTallerPage /> },
      { path: 'reportes/semanal', element: <ReporteSemanalPage /> },
      { path: 'reportes/evidencia', element: <EvidenciaPage /> },
      { path: 'catalogos', element: <CatalogosPage /> },
      { path: 'catalogos/tecnicos', element: <TecnicosPage /> },
      { path: 'catalogos/maquinas', element: <MaquinasPage /> },
      { path: 'catalogos/maquinas/:id/historial', element: <MaquinaHistorialPage /> },
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
      { path: 'tecnico', element: <TecnicoHomePage /> },
      { path: 'tecnico/servicio/:id/evidencia', element: <TecnicoEvidenciaPage /> },
      { path: 'tecnico/inventario', element: <TecnicoInventarioPage /> },
      { path: 'tecnico/servicio/:id/refacciones', element: <TecnicoRefaccionesPage /> },
    ],
  },

  // Fallback
  { path: '*', element: <Navigate to="/" replace /> },
])
