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
})
