import { spawnSync } from 'node:child_process'

const allowedVulnerabilities = {
  '@babel/plugin-transform-modules-systemjs': {
    advisories: new Set([
      '@babel/plugin-transform-modules-systemjs',
      'GHSA-fv7c-fp4j-7gwp',
    ]),
    reason: 'Transitive build-time dependency through workbox-build/Babel for PWA service worker generation. Not bundled into runtime app code.',
  },
  '@rollup/plugin-terser': {
    advisories: new Set([
      'serialize-javascript',
      'GHSA-5c6j-r48x-rmvq',
      'GHSA-qj8w-gfj5-8c6v',
    ]),
    reason: 'Parent package for the allowed serialize-javascript finding in the PWA build toolchain.',
  },
  'fast-uri': {
    advisories: new Set([
      'fast-uri',
      'GHSA-q3j6-qgpj-74h6',
      'GHSA-v39h-62p7-jpjc',
    ]),
    reason: 'Transitive dev/build-time dependency through AJV used by build/lint/PWA tooling. Not bundled into runtime app code.',
  },
  exceljs: {
    advisories: new Set([
      'uuid',
      'GHSA-w5hq-g745-h8pq',
    ]),
    reason: 'Parent package for the allowed uuid finding; Excel exports do not pass attacker-controlled uuid buffers.',
  },
  'serialize-javascript': {
    advisories: new Set([
      'serialize-javascript',
      'GHSA-5c6j-r48x-rmvq',
      'GHSA-qj8w-gfj5-8c6v',
    ]),
    reason: 'Transitive build-time dependency through vite-plugin-pwa/workbox-build. Not bundled into runtime app code.',
  },
  uuid: {
    advisories: new Set([
      'uuid',
      'GHSA-w5hq-g745-h8pq',
    ]),
    reason: 'Transitive ExcelJS dependency; app does not pass attacker-controlled uuid buffers.',
  },
  'vite-plugin-pwa': {
    advisories: new Set([
      'workbox-build',
      '@rollup/plugin-terser',
      'serialize-javascript',
      'GHSA-5c6j-r48x-rmvq',
      'GHSA-qj8w-gfj5-8c6v',
    ]),
    reason: 'Parent package for the allowed serialize-javascript finding in the PWA build toolchain.',
  },
  'workbox-build': {
    advisories: new Set([
      '@babel/plugin-transform-modules-systemjs',
      '@rollup/plugin-terser',
      'fast-uri',
      'serialize-javascript',
      'GHSA-fv7c-fp4j-7gwp',
      'GHSA-5c6j-r48x-rmvq',
      'GHSA-qj8w-gfj5-8c6v',
      'GHSA-q3j6-qgpj-74h6',
      'GHSA-v39h-62p7-jpjc',
    ]),
    reason: 'Parent package for allowed build-time findings in the PWA build toolchain.',
  },
}

function severityRank(severity) {
  return ['info', 'low', 'moderate', 'high', 'critical'].indexOf(severity)
}

function extractViaIdentifiers(via) {
  const identifiers = via.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]

    if (entry && typeof entry === 'object') {
      const identifiers = []
      const advisoryMatch = typeof entry.url === 'string'
        ? entry.url.match(/GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i)
        : null

      if (advisoryMatch) identifiers.push(advisoryMatch[0])
      if (typeof entry.source === 'string') identifiers.push(entry.source)
      if (typeof entry.name === 'string') identifiers.push(entry.name)
      if (typeof entry.dependency === 'string') identifiers.push(entry.dependency)

      return identifiers
    }

    return []
  }).filter((entry) => typeof entry === 'string' && entry.length > 0)

  return [...new Set(identifiers)]
}

function isAllowed(name, vulnerability) {
  const policy = allowedVulnerabilities[name]
  if (!policy) return false

  const viaIdentifiers = extractViaIdentifiers(vulnerability.via ?? [])
  if (viaIdentifiers.length === 0) return false
  return viaIdentifiers.every((id) => policy.advisories.has(id))
}

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (!result.stdout) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

let auditReport
try {
  auditReport = JSON.parse(result.stdout)
} catch (error) {
  process.stderr.write(result.stdout)
  process.stderr.write(result.stderr)
  process.stderr.write(`\nNo se pudo parsear npm audit --json: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const blocking = []
const allowed = []

for (const [name, vulnerability] of Object.entries(auditReport.vulnerabilities ?? {})) {
  if (severityRank(vulnerability.severity) < severityRank('moderate')) continue

  if (isAllowed(name, vulnerability)) {
    allowed.push({ name, severity: vulnerability.severity, reason: allowedVulnerabilities[name].reason })
    continue
  }

  blocking.push({ name, severity: vulnerability.severity, via: extractViaIdentifiers(vulnerability.via ?? []) })
}

if (allowed.length > 0) {
  console.log('Allowed audit findings:')
  for (const finding of allowed) {
    console.log(`- ${finding.name} (${finding.severity}): ${finding.reason}`)
  }
}

if (blocking.length > 0) {
  console.error('Blocking audit findings:')
  for (const finding of blocking) {
    const via = finding.via.length > 0 ? ` ${finding.via.join(', ')}` : ''
    console.error(`- ${finding.name} (${finding.severity})${via}`)
  }
  process.exit(1)
}

console.log('No blocking npm audit findings at moderate or higher severity.')
