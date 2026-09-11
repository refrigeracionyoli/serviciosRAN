// Respalda a disco todas las tablas de Supabase antes de aplicar una migración.
//
// Es de sólo lectura: nunca escribe ni borra nada en la base de datos.
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node tools/backup-supabase-data.mjs [carpeta-destino]
//
// La service role key se pasa por variable de entorno a propósito: no debe quedar
// guardada en .env ni en el repositorio. Se requiere esa llave (y no la anon key)
// porque con RLS activo la anon key sólo devolvería una parte de los registros y el
// respaldo quedaría incompleto sin avisar.
//
// El respaldo se guarda en backups/<timestamp>/ que está en .gitignore: contiene
// datos reales de clientes y no debe subirse al repositorio.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Todas las tablas de negocio declaradas en supabase/migrations.
const TABLES = [
  'profiles',
  'clientes',
  'maquinas',
  'polizas',
  'poliza_estado_historial',
  'poliza_pausas',
  'servicios',
  'servicio_refacciones',
  'cierres',
  'evidencias',
  'mantenimientos_poliza',
  'inventario',
  'inventario_tecnico',
  'movimientos_inventario',
  'maquinas_en_taller',
  'maquinas_taller_movimientos',
  'catalogo_pep',
]

const PAGE_SIZE = 1000

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }

  console.error(`Falta la variable de entorno ${names.join(' o ')}.`)
  process.exit(1)
}

// PostgREST responde PGRST205 cuando la tabla no existe en el esquema. No es un fallo del
// respaldo: hay tablas declaradas en las migraciones que nunca se crearon en producción
// (catalogo_pep, por ejemplo, quedó sin usarse porque el PEP se resuelve desde la
// plantilla de Excel). Se distingue de un error real para no dar por bueno un respaldo
// incompleto ni bloquearlo por una tabla que no existe.
const MISSING_TABLE_CODE = 'PGRST205'

class MissingTableError extends Error {}

async function fetchPage(baseUrl, serviceKey, table, from, to) {
  const url = `${baseUrl}/rest/v1/${table}?select=*&order=id.asc`
  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Range: `${from}-${to}`,
      Prefer: 'count=exact',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    if (body.includes(MISSING_TABLE_CODE)) {
      throw new MissingTableError(table)
    }
    throw new Error(`${table}: HTTP ${response.status} ${body}`)
  }

  return response.json()
}

/**
 * Algunas tablas de bitácora no tienen columna `id`. Si el orden falla se reintenta
 * sin ordenar, porque para un respaldo importa la integridad y no el orden.
 */
async function fetchTable(baseUrl, serviceKey, table) {
  const rows = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    let page

    try {
      page = await fetchPage(baseUrl, serviceKey, table, from, to)
    } catch (error) {
      if (from === 0 && String(error.message).includes('42703')) {
        page = await fetchPageUnordered(baseUrl, serviceKey, table, from, to)
      } else {
        throw error
      }
    }

    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchPageUnordered(baseUrl, serviceKey, table, from, to) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Range: `${from}-${to}`,
    },
  })

  if (!response.ok) {
    throw new Error(`${table}: HTTP ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function main() {
  const baseUrl = requireEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const targetDir = path.resolve(process.argv[2] ?? `backups/${timestamp}`)
  fs.mkdirSync(targetDir, { recursive: true })

  console.log(`Respaldando ${baseUrl} en ${targetDir}`)

  const manifest = { generadoEn: new Date().toISOString(), origen: baseUrl, tablas: {} }
  let failed = false

  for (const table of TABLES) {
    try {
      const rows = await fetchTable(baseUrl, serviceKey, table)
      fs.writeFileSync(path.join(targetDir, `${table}.json`), JSON.stringify(rows, null, 2))
      manifest.tablas[table] = rows.length
      console.log(`  ✓ ${table}: ${rows.length} registros`)
    } catch (error) {
      if (error instanceof MissingTableError) {
        manifest.tablas[table] = 'NO EXISTE en la base de datos'
        console.log(`  – ${table}: no existe en la base de datos, nada que respaldar`)
        continue
      }

      failed = true
      manifest.tablas[table] = `ERROR: ${error.message}`
      console.error(`  ✗ ${table}: ${error.message}`)
    }
  }

  fs.writeFileSync(path.join(targetDir, '_manifest.json'), JSON.stringify(manifest, null, 2))

  if (failed) {
    console.error('\nEl respaldo terminó con errores. NO apliques la migración hasta resolverlos.')
    process.exit(1)
  }

  console.log(`\nRespaldo completo. Verifica los conteos en ${path.join(targetDir, '_manifest.json')} antes de migrar.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
