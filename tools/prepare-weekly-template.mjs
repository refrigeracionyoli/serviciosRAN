// Prepara el formato semanal que envía Heineken para usarlo como plantilla del sistema.
//
// El archivo original no se puede empaquetar tal cual: la hoja "Registro Refacciones"
// viene extendida hasta el último renglón de Excel (1,048,576 filas ≈ 189 MB de XML sin
// comprimir), lo que haría que el navegador tuviera que descomprimir y parsear todo eso
// cada vez que se genera un reporte. Además la carátula trae la GZ de otro taller.
//
// Uso:
//   node tools/prepare-weekly-template.mjs <archivo-origen.xlsx> [archivo-destino.xlsx]
//
// El destino por omisión es public/report-templates/formato-semanal-2026.xlsx.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import UZIP from 'uzip'

const DEFAULT_TARGET = 'public/report-templates/formato-semanal-2026.xlsx'

// Configuración del taller que debe conservarse al adoptar un formato nuevo.
const TALLER_GZ = 'NUEVO LEON'

const CARATULA_SHEET = 'xl/worksheets/sheet1.xml'
const REFACCIONES_SHEET = 'xl/worksheets/sheet3.xml'
const REFACCIONES_KEPT_ROWS = 2
const REFACCIONES_DIMENSION = `A1:I${REFACCIONES_KEPT_ROWS}`

const decoder = new TextDecoder('utf-8')
const encoder = new TextEncoder()

function readXml(files, entry) {
  const bytes = files[entry]
  if (!bytes) throw new Error(`La plantilla no contiene ${entry}.`)
  return decoder.decode(bytes)
}

function writeXml(files, entry, xml) {
  files[entry] = encoder.encode(xml)
}

/**
 * Recorta la hoja de refacciones dejando sólo el encabezado y la fila plantilla.
 * El export sustituye todo desde la fila 2 en tiempo de ejecución, así que las filas
 * vacías restantes sólo cuestan memoria.
 *
 * Se hace por texto y no con un DOM a propósito: son ~189 MB de XML y parsearlos
 * completos para tirar el 99.9% sería innecesariamente costoso.
 */
function trimRegistroRefacciones(files) {
  const xml = readXml(files, REFACCIONES_SHEET)
  const firstDroppedRow = `<row r="${REFACCIONES_KEPT_ROWS + 1}"`
  const rowStart = xml.indexOf(firstDroppedRow)

  if (rowStart === -1) {
    return { trimmed: false, removedRows: 0 }
  }

  const sheetDataEnd = xml.indexOf('</sheetData>', rowStart)
  if (sheetDataEnd === -1) {
    throw new Error('La hoja "Registro Refacciones" no tiene un bloque <sheetData> válido.')
  }

  const dropped = xml.slice(rowStart, sheetDataEnd)
  const removedRows = (dropped.match(/<row /g) ?? []).length
  const trimmedXml = `${xml.slice(0, rowStart)}${xml.slice(sheetDataEnd)}`
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${REFACCIONES_DIMENSION}"/>`)

  writeXml(files, REFACCIONES_SHEET, trimmedXml)
  return { trimmed: true, removedRows }
}

/**
 * Restaura la GZ del taller en la carátula. Heineken distribuye el formato con la GZ
 * de quien lo exportó; si se quedara así, `loadTemplateLookups` tomaría esa GZ como
 * predeterminada y todos los PEP se resolverían contra el catálogo equivocado.
 */
function setTallerGz(files) {
  const xml = readXml(files, CARATULA_SHEET)
  const cellPattern = /<c r="D16"[^>]*?(?: s="(\d+)")?[^>]*>.*?<\/c>|<c r="D16"[^>]*\/>/s
  const match = xml.match(cellPattern)

  if (!match) {
    throw new Error('No se encontró la celda D16 (GZ) en la carátula.')
  }

  const styleAttribute = match[1] ? ` s="${match[1]}"` : ''
  const replacement = `<c r="D16"${styleAttribute} t="inlineStr"><is><t>${TALLER_GZ}</t></is></c>`

  writeXml(files, CARATULA_SHEET, xml.replace(cellPattern, replacement))
  return { previous: match[0] }
}

/**
 * Quita la cadena de cálculo. El export la borra de todos modos antes de entregar el
 * archivo, así que empaquetarla sólo agrega ~22 MB que hay que descomprimir en cada
 * generación de reporte.
 */
function removeCalcChain(files) {
  if (!files['xl/calcChain.xml']) return { removed: false }

  delete files['xl/calcChain.xml']

  const contentTypes = readXml(files, '[Content_Types].xml')
  writeXml(
    files,
    '[Content_Types].xml',
    contentTypes.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''),
  )

  const workbookRels = readXml(files, 'xl/_rels/workbook.xml.rels')
  writeXml(
    files,
    'xl/_rels/workbook.xml.rels',
    workbookRels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, ''),
  )

  return { removed: true }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function main() {
  const [sourceArg, targetArg] = process.argv.slice(2)

  if (!sourceArg) {
    console.error('Uso: node tools/prepare-weekly-template.mjs <archivo-origen.xlsx> [archivo-destino.xlsx]')
    process.exit(1)
  }

  const sourcePath = path.resolve(sourceArg)
  const targetPath = path.resolve(targetArg ?? DEFAULT_TARGET)

  if (!fs.existsSync(sourcePath)) {
    console.error(`No existe el archivo de origen: ${sourcePath}`)
    process.exit(1)
  }

  const sourceBytes = fs.readFileSync(sourcePath)
  const files = UZIP.parse(
    sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength),
  )

  const refacciones = trimRegistroRefacciones(files)
  const gz = setTallerGz(files)
  const calcChain = removeCalcChain(files)

  const outputBytes = new Uint8Array(UZIP.encode(files))
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, outputBytes)

  console.log(`Origen:  ${sourcePath} (${formatBytes(sourceBytes.byteLength)})`)
  console.log(`Destino: ${targetPath} (${formatBytes(outputBytes.byteLength)})`)
  console.log(`- Registro Refacciones: ${refacciones.trimmed ? `${refacciones.removedRows} filas vacías eliminadas` : 'sin filas sobrantes'}`)
  console.log(`- Carátula GZ: ${gz.previous} -> ${TALLER_GZ}`)
  console.log(`- calcChain.xml: ${calcChain.removed ? 'eliminado' : 'no estaba presente'}`)
}

main()
