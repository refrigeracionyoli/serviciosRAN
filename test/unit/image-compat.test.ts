import { beforeEach, describe, expect, it, vi } from 'vitest'

const { heicToMock } = vi.hoisted(() => ({
  heicToMock: vi.fn(async () => new Blob(['jpeg-data'], { type: 'image/jpeg' })),
}))

vi.mock('heic-to/csp', () => ({
  heicTo: heicToMock,
}))

import {
  blobHasHeicSignature,
  convertHeicBlobToJpeg,
  convertHeicFileToJpeg,
  hasHeicFormatHint,
  toJpegFilename,
} from '@/lib/image-compat'

function buildHeicBlob(): Blob {
  return new Blob([
    new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ]),
  ], { type: 'image/heic' })
}

describe('HEIC image compatibility', () => {
  beforeEach(() => {
    heicToMock.mockClear()
  })

  it('detects HEIC metadata and file signatures', async () => {
    expect(hasHeicFormatHint({ filename: 'foto.HEIC' })).toBe(true)
    expect(hasHeicFormatHint({ mimeType: 'image/heif' })).toBe(true)
    expect(hasHeicFormatHint({ r2Key: '10/evidencias/123-foto.heic' })).toBe(true)
    expect(hasHeicFormatHint({ filename: 'foto.jpg', mimeType: 'image/jpeg' })).toBe(false)
    expect(await blobHasHeicSignature(buildHeicBlob())).toBe(true)
    expect(await blobHasHeicSignature(new Blob(['jpeg-data'], { type: 'image/jpeg' }))).toBe(false)
  })

  it('keeps service prefixes while changing the output extension to JPEG', () => {
    expect(toJpegFilename('orden-servicio__123__IMG_1000.HEIC'))
      .toBe('orden-servicio__123__IMG_1000.jpg')
    expect(toJpegFilename('foto-sin-extension')).toBe('foto-sin-extension.jpg')
  })

  it('converts HEIC blobs and files to JPEG', async () => {
    const blob = buildHeicBlob()
    const convertedBlob = await convertHeicBlobToJpeg(blob)
    const convertedFile = await convertHeicFileToJpeg(
      new File([blob], 'IMG_1000.HEIC', { type: 'image/heic', lastModified: 123 }),
    )

    expect(convertedBlob.type).toBe('image/jpeg')
    expect(convertedFile.name).toBe('IMG_1000.jpg')
    expect(convertedFile.type).toBe('image/jpeg')
    expect(convertedFile.lastModified).toBe(123)
    expect(heicToMock).toHaveBeenCalledTimes(2)
  })

  it('does not load the converter for regular JPEG files', async () => {
    const jpeg = new Blob(['jpeg-data'], { type: 'image/jpeg' })
    expect(await convertHeicBlobToJpeg(jpeg)).toBe(jpeg)
    expect(heicToMock).not.toHaveBeenCalled()
  })
})
