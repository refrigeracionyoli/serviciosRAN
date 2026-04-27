import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function listFiles(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory)
  return readdirSync(absoluteDirectory).flatMap((entry) => {
    const absolutePath = path.join(absoluteDirectory, entry)
    const relativePath = path.join(directory, entry)
    if (statSync(absolutePath).isDirectory()) return listFiles(relativePath)
    return relativePath
  })
}

describe('security contracts', () => {
  it('keeps real environment values out of .env.example', () => {
    const envExample = readRepoFile('.env.example')

    expect(envExample).toContain('https://PROJECT_REF.supabase.co')
    expect(envExample).not.toContain('ybrfrixfewarnderdsqi')
    expect(envExample).not.toMatch(/eyJ[a-zA-Z0-9_-]+\./)
  })

  it('does not expose server-only secrets in browser source', () => {
    const clientSource = listFiles('src')
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => readRepoFile(file))
      .join('\n')

    expect(clientSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(clientSource).not.toContain('R2_SECRET_ACCESS_KEY')
    expect(clientSource).not.toContain('R2_ACCESS_KEY_ID')
  })

  it('keeps production security headers in Vercel config', () => {
    const vercelConfig = JSON.parse(readRepoFile('vercel.json')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>
    }
    const headers = new Map(vercelConfig.headers.flatMap((entry) => entry.headers.map((header) => [header.key, header.value])))

    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000')
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(headers.get('Content-Security-Policy')).toContain("object-src 'none'")
  })

  it('requires dynamic CORS origins in Edge Function responses', () => {
    const corsHelper = readRepoFile('supabase/functions/_shared/cors.ts')
    const functionFiles = listFiles('supabase/functions')
      .filter((file) => file.endsWith('/index.ts'))
      .map((file) => [file, readRepoFile(file)] as const)

    expect(corsHelper).toContain('export function getCorsHeaders')
    expect(corsHelper).not.toContain("allowedOrigins.length === 1 ? allowedOrigins[0] : '*'")

    for (const [file, source] of functionFiles) {
      expect(source, file).toContain('handleCors(req)')
      expect(source, file).toContain('getCorsHeaders(req)')
      expect(source, file).not.toContain('import { corsHeaders')
    }
  })

  it('keeps privileged Edge Functions behind role checks', () => {
    const adminCreate = readRepoFile('supabase/functions/admin-create-tecnico/index.ts')
    const adminReset = readRepoFile('supabase/functions/admin-reset-empleado-password/index.ts')
    const r2Functions = [
      'supabase/functions/r2-upload/index.ts',
      'supabase/functions/r2-presigned-put/index.ts',
      'supabase/functions/r2-presigned-get/index.ts',
      'supabase/functions/r2-delete/index.ts',
    ].map(readRepoFile)

    expect(adminCreate).toContain("requireRole(req, 'admin')")
    expect(adminReset).toContain("requireRole(req, 'admin')")

    for (const source of r2Functions) {
      expect(source).toContain("requireAnyRole(req, ['admin', 'tecnico'])")
    }
  })
})
