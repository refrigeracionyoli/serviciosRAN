export function hasPreloadedAdminRouteModules(): boolean {
  return true
}

export function preloadAdminRouteModules(): Promise<void> {
  return Promise.resolve()
}
