import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('egress reduction contracts', () => {
  it('downloads evidence bytes directly from signed R2 URLs before falling back to Edge proxying', () => {
    const r2Client = read('src/lib/r2.ts')

    expect(r2Client).toContain('const { downloadUrl } = await getPresignedGetUrl(r2Key, options)')
    expect(r2Client).toContain('await fetch(downloadUrl')
    expect(r2Client).toContain("cache: 'force-cache'")
    expect(r2Client).toContain("invokeBlobFunctionWithAuthRetry('r2-presigned-get'")
    expect(r2Client).toContain('download: true')
  })

  it('persists large report templates in browser cache storage', () => {
    const reportes = read('src/lib/reportes-export.ts')

    expect(reportes).toContain('TEMPLATE_CACHE_NAME')
    expect(reportes).toContain('await caches.open(TEMPLATE_CACHE_NAME)')
    expect(reportes).toContain('persistentCache.match(url)')
    expect(reportes).toContain('persistentCache.put(url, response.clone())')
    expect(reportes).toContain("fetch(url, { cache: 'force-cache' })")
    expect(reportes).toContain('cloneArrayBuffer')
  })

  it('keeps offline preload refreshes bounded to reduce recurring Supabase egress', () => {
    const adminPreload = read('src/lib/offline/preload.ts')
    const adminHook = read('src/hooks/use-offline-admin-preload.ts')
    const tecnicoPreload = read('src/lib/offline/tecnico-preload.ts')
    const tecnicoHook = read('src/hooks/use-offline-tecnico-preload.ts')

    expect(adminPreload).toContain('const PRELOAD_MIN_INTERVAL_MS = 1000 * 60 * 60 * 4')
    expect(adminPreload).toContain('const ADMIN_BOOTSTRAP_LOOKBACK_DAYS = 7')
    expect(adminHook).toContain('const PRELOAD_RETRY_INTERVAL_MS = 1000 * 60 * 60 * 4')
    expect(tecnicoPreload).toContain('const PRELOAD_MIN_INTERVAL_MS = 1000 * 60 * 60')
    expect(tecnicoHook).toContain('const PRELOAD_RETRY_INTERVAL_MS = 1000 * 60 * 60')
  })

  it('debounces realtime invalidations to avoid refetch storms from database triggers', () => {
    const realtimeHook = read('src/hooks/use-realtime-invalidations.ts')

    expect(realtimeHook).toContain('const REALTIME_INVALIDATION_DEBOUNCE_MS = 5000')
    expect(realtimeHook).toContain('scheduleQueryWork')
    expect(realtimeHook).toContain('window.clearTimeout(pendingTimeout)')
    expect(realtimeHook).toContain("queryClient.invalidateQueries({ queryKey, refetchType: 'active' })")
    expect(realtimeHook).toContain("queryClient.refetchQueries({ queryKey, type: 'active' })")
  })

  it('keeps the servicios admin table bounded with chunked server-side pagination', () => {
    const serviciosPage = read('src/pages/admin/servicios/ServiciosPage.tsx')
    const serviciosHook = read('src/hooks/use-servicios.ts')

    expect(serviciosPage).toContain('const CHUNK_PAGE_COUNT = 5')
    expect(serviciosPage).toContain('const CHUNK_SIZE = PAGE_SIZE * CHUNK_PAGE_COUNT')
    expect(serviciosPage).toContain('const SEARCH_DEBOUNCE_MS = 400')
    expect(serviciosPage).toContain('function useDebouncedValue')
    expect(serviciosPage).toContain('const debouncedSearch = useDebouncedValue')
    expect(serviciosPage).toContain('const searchInputRef = useRef<HTMLInputElement | null>(null)')
    expect(serviciosPage).toContain('const shouldRefocusSearchRef = useRef(false)')
    expect(serviciosPage).toContain('const isPageLoading = isLoading && !hasLoadedServiciosOnce')
    expect(serviciosPage).toContain('isFetching')
    expect(serviciosPage).toContain('const isTableSearching = isFetching && hasLoadedServiciosOnce')
    expect(serviciosPage).toContain('{isPageLoading || isTableSearching ? (')
    expect(serviciosPage).toContain('{isTableSearching ? (')
    expect(serviciosPage).toContain('<AdminTableSkeleton rows={7} columns={6} />')
    expect(serviciosPage).toContain('searchInputRef.current?.focus({ preventScroll: true })')
    expect(serviciosPage).toContain('ref={searchInputRef}')
    expect(serviciosPage).toContain('const serviciosQueryFilters = useMemo(() => ({')
    expect(serviciosPage).toContain('search: debouncedSearch || null')
    expect(serviciosPage).toContain('useServiciosChunkQuery({')
    expect(serviciosPage).toContain('from: chunkStart')
    expect(serviciosPage).toContain('to: chunkEnd')
    expect(serviciosPage).toContain('const totalServicios = serviciosChunk?.totalCount ?? 0')
    expect(serviciosPage).toContain('const pageRows = servicios.slice(pageOffsetInChunk, pageOffsetInChunk + PAGE_SIZE)')
    expect(serviciosPage).not.toContain('defaultTableDateRange')
    expect(serviciosPage).not.toContain('useDeferredValue')
    expect(serviciosPage).not.toContain('const { data: servicios = [], isLoading } = useServiciosQuery()')

    expect(serviciosHook).toContain('export function useServiciosChunkQuery')
    expect(serviciosHook).toContain("select(SELECT_SERVICIO, { count: 'exact' })")
    expect(serviciosHook).toContain('query.range(input.from, input.to)')
    expect(serviciosHook).toContain('fetchServiciosForListExport')
  })
})
