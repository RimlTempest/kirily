import type { KirilyError } from './error.ts'
import { KirilyErrorCode, kirilyError } from './error.ts'
import type { Result } from './result.ts'
import { err, ok } from './result.ts'

/** The formats the MVP accepts. GIF and AVIF are Phase 2. */
export const SupportedMimeType = {
  Png: 'image/png',
  Jpeg: 'image/jpeg',
  WebP: 'image/webp',
} as const

export type SupportedMimeType = (typeof SupportedMimeType)[keyof typeof SupportedMimeType]

const SUPPORTED: readonly string[] = Object.values(SupportedMimeType)

export const isSupportedMimeType = (value: string): value is SupportedMimeType =>
  SUPPORTED.includes(value)

/**
 * The image the user opened. `bitmap` is the only decoded copy Kirily keeps at
 * full resolution; the preview is derived from it and thrown away. Width and
 * height are kept separately because export needs them even after the bitmap
 * has been closed to free memory (kirily-design.md §6).
 */
export type SourceImage = {
  readonly width: number
  readonly height: number
  readonly mimeType: SupportedMimeType
  readonly fileName: string
  readonly fileSize: number
}

/**
 * Above this, editing a full-resolution mask plus an RGBA buffer plus an AI
 * tensor stops fitting comfortably in a browser tab (IMPLEMENTATION.md §61).
 * The number is a starting point to be replaced by real measurements.
 */
export const MAX_MEGAPIXELS = 50

export const megapixels = (width: number, height: number): number => (width * height) / 1_000_000

/**
 * Validates the metadata of a file before anything is decoded. The extension
 * is not consulted: only the MIME type the browser reports and the decoded
 * dimensions are trusted (IMPLEMENTATION.md §7).
 */
export const describeSource = (input: {
  readonly width: number
  readonly height: number
  readonly mimeType: string
  readonly fileName: string
  readonly fileSize: number
}): Result<SourceImage, KirilyError> => {
  if (!isSupportedMimeType(input.mimeType)) {
    return err(kirilyError(KirilyErrorCode.UnsupportedFormat, input.mimeType))
  }
  if (
    !Number.isInteger(input.width)
    || !Number.isInteger(input.height)
    || input.width < 1
    || input.height < 1
  ) {
    return err(kirilyError(KirilyErrorCode.ImageDecodeFailed, `${input.width}x${input.height}`))
  }
  if (megapixels(input.width, input.height) > MAX_MEGAPIXELS) {
    return err(
      kirilyError(
        KirilyErrorCode.ImageTooLarge,
        `${megapixels(input.width, input.height).toFixed(1)}MP`,
      ),
    )
  }

  return ok({
    width: input.width,
    height: input.height,
    mimeType: input.mimeType,
    fileName: input.fileName,
    fileSize: input.fileSize,
  })
}

/**
 * `cat.jpg` → `cat-kirily.png`. Strips directory separators and control
 * characters: a file name is user input and ends up in a download attribute
 * (IMPLEMENTATION.md §63, §64).
 */
export const exportFileName = (fileName: string, extension: string): string => {
  const base = fileName.replace(/\.[^.]+$/, '')
  // Written as a filter rather than a regex so the set of rejected characters
  // is readable and no control character has to appear in a literal.
  const forbidden = '/\\:*?"<>|'
  const safe = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f && !forbidden.includes(ch)
    })
    .join('')
    .replace(/^[.\s]+/, '')
    .trim()
  return `${safe.length > 0 ? safe : 'image'}-kirily.${extension}`
}
