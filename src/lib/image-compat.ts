const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'])
const HEIC_EXTENSION_PATTERN = /\.hei[cf](?:$|[?#])/i

export interface ImageFormatHint {
  filename?: string | null
  mimeType?: string | null
  r2Key?: string | null
}

function normalizeMimeType(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().split(';')[0].trim()
}

function decodeAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

async function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }

  if (typeof FileReader === 'undefined') {
    throw new Error('Este navegador no permite leer el archivo de imagen.')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
        return
      }
      reject(new Error('No se pudo leer el archivo de imagen.'))
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'))
    reader.readAsArrayBuffer(blob)
  })
}

export function hasHeicFormatHint(hint: ImageFormatHint): boolean {
  return HEIC_MIME_TYPES.has(normalizeMimeType(hint.mimeType))
    || HEIC_EXTENSION_PATTERN.test(String(hint.filename ?? ''))
    || HEIC_EXTENSION_PATTERN.test(String(hint.r2Key ?? ''))
}

export async function blobHasHeicSignature(blob: Blob): Promise<boolean> {
  if (blob.size < 12) return false

  const header = new Uint8Array(await readBlobArrayBuffer(blob.slice(0, 12)))
  return decodeAscii(header.slice(4, 8)) === 'ftyp'
    && HEIC_BRANDS.has(decodeAscii(header.slice(8, 12)))
}

export function toJpegFilename(filename: string | null | undefined): string {
  const normalized = String(filename ?? '').trim() || 'evidencia'
  const withoutExtension = normalized.replace(/\.[^./\\]+$/, '')
  return `${withoutExtension}.jpg`
}

export async function convertHeicBlobToJpeg(blob: Blob, quality = 0.82): Promise<Blob> {
  if (!(await blobHasHeicSignature(blob))) return blob

  try {
    const { heicTo } = await import('heic-to/csp')
    return await heicTo({
      blob,
      type: 'image/jpeg',
      quality,
    })
  } catch {
    throw new Error('No se pudo convertir la imagen HEIC a JPEG. Intenta seleccionar la foto nuevamente.')
  }
}

export async function convertHeicFileToJpeg(file: File, quality = 0.82): Promise<File> {
  const converted = await convertHeicBlobToJpeg(file, quality)
  if (converted === file) return file

  return new File([converted], toJpegFilename(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    throw new Error('Este navegador no permite preparar la vista previa de la imagen.')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('No se pudo preparar la vista previa de la imagen.'))
    }
    reader.onerror = () => reject(new Error('No se pudo preparar la vista previa de la imagen.'))
    reader.readAsDataURL(blob)
  })
}
