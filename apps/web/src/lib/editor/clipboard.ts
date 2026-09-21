/**
 * The clipboard, in and out.
 *
 * A browser-only tool that cannot take a screenshot straight out of the
 * clipboard, or hand the result to the next app without a trip through the
 * downloads folder, is making the user do the part the browser is best at.
 *
 * Both directions are guarded rather than assumed: `ClipboardItem` is missing
 * in some browsers, writing needs a user gesture and a secure context, and
 * reading asks a permission that can be refused. None of that is an error the
 * user caused, so each returns a `Result` and the caller decides what to say.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

/** Only what the editor can open. */
const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp'])

/**
 * The part of a `DataTransferItem` this needs.
 *
 * Structural rather than the DOM type, so a test can hand it a plain object
 * without an assertion — and so the function says what it actually reads.
 */
export type PastedItem = {
  readonly kind: string
  readonly type: string
  readonly getAsFile: () => File | null
}

export const canCopy = (): boolean =>
  typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'

export const canPaste = (): boolean => typeof navigator.clipboard?.read === 'function'

/**
 * Picks the first image out of a paste.
 *
 * Exported and taking the items rather than reading the clipboard itself, so
 * it covers both routes: the paste event, which needs no permission, and
 * `navigator.clipboard.read`, which does.
 */
export const imageFrom = (items: readonly PastedItem[]): File | null => {
  for (const item of items) {
    if (item.kind !== 'file') continue
    if (!SUPPORTED.has(item.type)) continue
    const file = item.getAsFile()
    if (file !== null) return file
  }
  return null
}

/** Reads an image out of the clipboard, asking permission if the browser wants to. */
export const readImage = async (): Promise<Result<File, KirilyError>> => {
  if (!canPaste()) {
    return err(kirilyError(KirilyErrorCode.InvalidFile, 'clipboard read unavailable'))
  }
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((candidate) => SUPPORTED.has(candidate))
      if (type === undefined) continue
      const blob = await item.getType(type)
      return ok(new File([blob], `clipboard.${type.slice(6)}`, { type }))
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.InvalidFile, detail))
  }
  return err(kirilyError(KirilyErrorCode.UnsupportedFormat, 'no image on the clipboard'))
}

/**
 * Puts a blob on the clipboard.
 *
 * The `ClipboardItem` is built with the promise rather than the resolved blob
 * on purpose: Safari loses the user gesture across an await, and a write that
 * is not tied to one is refused.
 */
export const writeImage = async (blob: Blob): Promise<Result<void, KirilyError>> => {
  if (!canCopy()) {
    return err(kirilyError(KirilyErrorCode.ExportFailed, 'clipboard write unavailable'))
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return ok(undefined)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.ExportFailed, detail))
  }
}
