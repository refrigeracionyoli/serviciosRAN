const tecnicoRouteImporters = [
  () => import('@/pages/tecnico/TecnicoHomePage'),
  () => import('@/pages/tecnico/TecnicoServicioDetallePage'),
  () => import('@/pages/tecnico/TecnicoEvidenciaPage'),
  () => import('@/pages/tecnico/TecnicoRefaccionesPage'),
  () => import('@/pages/tecnico/TecnicoInventarioPage'),
  () => import('@/pages/tecnico/TecnicoMantenimientoPage'),
  () => import('@/pages/tecnico/TecnicoPerfilPage'),
]

let tecnicoRouteModulesReady = false
let tecnicoRouteModulesPromise: Promise<void> | null = null

export function hasPreloadedTecnicoRouteModules(): boolean {
  return tecnicoRouteModulesReady
}

export function preloadTecnicoRouteModules(): Promise<void> {
  if (tecnicoRouteModulesReady) {
    return Promise.resolve()
  }

  if (tecnicoRouteModulesPromise) {
    return tecnicoRouteModulesPromise
  }

  tecnicoRouteModulesPromise = Promise
    .all(tecnicoRouteImporters.map((loadRoute) => loadRoute()))
    .then(() => {
      tecnicoRouteModulesReady = true
    })
    .catch((error: unknown) => {
      tecnicoRouteModulesPromise = null
      throw error
    })

  return tecnicoRouteModulesPromise
}
