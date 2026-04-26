/// <reference types="vite/client" />

declare module 'uzip' {
  export interface ZipEntryMetadata {
    size: number
    csize: number
  }

  export interface UZipStatic {
    parse(buffer: ArrayBuffer, onlyNames?: false): Record<string, Uint8Array>
    parse(buffer: ArrayBuffer, onlyNames: true): Record<string, ZipEntryMetadata>
    encode(files: Record<string, Uint8Array>, noCompression?: boolean): ArrayBuffer
  }

  const UZIP: UZipStatic
  export default UZIP
}
