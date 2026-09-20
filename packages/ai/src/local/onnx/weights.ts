/**
 * Fetching model weights.
 *
 * Cloudflare caps a static asset at 25 MiB, and the quality model is four
 * times that, so the weights are published as shards and reassembled here
 * (ADR-0007). Serving them from Kirily's own origin is what lets the Content
 * Security Policy stay at `connect-src 'self'`: the page never opens a
 * connection to anyone else, which is the same promise that keeps the user's
 * image on their device.
 */
import type { KirilyError } from '@kirily/contract/error'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import type { Result } from '@kirily/contract/result'
import { err, ok } from '@kirily/contract/result'

export type WeightManifest = {
  readonly id: string
  /** Total size of the reassembled file. */
  readonly bytes: number
  /** SHA-256 of the reassembled file, lowercase hex. */
  readonly sha256: string
  /** Shard file names, in order. Relative to the manifest. */
  readonly shards: readonly string[]
}

export type FetchLike = (input: string) => Promise<Response>

export type LoadWeightsDeps = {
  readonly fetch: FetchLike
  /** Injected so the loader can be tested without WebCrypto. */
  readonly digest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>
}

export const isWeightManifest = (value: unknown): value is WeightManifest =>
  typeof value === 'object'
  && value !== null
  && typeof Reflect.get(value, 'id') === 'string'
  && typeof Reflect.get(value, 'bytes') === 'number'
  && typeof Reflect.get(value, 'sha256') === 'string'
  && Array.isArray(Reflect.get(value, 'shards'))
  && Reflect.get(value, 'shards').every((shard: unknown) => typeof shard === 'string')

/**
 * Downloads and reassembles the weights, reporting progress as a fraction.
 *
 * Progress is measured in bytes against the manifest rather than in shards:
 * "3 of 5 files" jumps in a way that reads as a stall on a slow connection.
 */
export const loadWeights = async (
  deps: LoadWeightsDeps,
  baseUrl: string,
  onProgress?: (fraction: number) => void,
  // `ArrayBuffer` rather than `ArrayBufferLike`: WebCrypto and the ONNX
  // runtime both refuse a view onto a SharedArrayBuffer.
): Promise<Result<Uint8Array<ArrayBuffer>, KirilyError>> => {
  const manifest = await loadManifest(deps, baseUrl)
  if (!manifest.ok) return manifest

  const total = manifest.value.bytes
  const weights = new Uint8Array(total)
  let offset = 0

  for (const shard of manifest.value.shards) {
    const response = await request(deps, `${baseUrl}/${shard}`)
    if (!response.ok) return response

    const buffer = new Uint8Array(await response.value.arrayBuffer())
    if (offset + buffer.length > total) {
      return err(
        kirilyError(
          KirilyErrorCode.AiInitializationFailed,
          `shards exceed the ${total} bytes the manifest declares`,
        ),
      )
    }
    weights.set(buffer, offset)
    offset += buffer.length
    onProgress?.(offset / total)
  }

  if (offset !== total) {
    return err(
      kirilyError(
        KirilyErrorCode.AiInitializationFailed,
        `expected ${total} bytes, assembled ${offset}`,
      ),
    )
  }

  const digest = deps.digest ?? sha256Hex
  const actual = await digest(weights)
  if (actual !== manifest.value.sha256) {
    // A truncated or swapped model does not fail loudly — it produces a
    // nonsense mask — so the integrity check is not optional.
    return err(
      kirilyError(
        KirilyErrorCode.AiInitializationFailed,
        `sha256 mismatch for ${manifest.value.id}`,
      ),
    )
  }

  return ok(weights)
}

const loadManifest = async (
  deps: LoadWeightsDeps,
  baseUrl: string,
): Promise<Result<WeightManifest, KirilyError>> => {
  const response = await request(deps, `${baseUrl}/manifest.json`)
  if (!response.ok) return response

  const parsed: unknown = await response.value.json().catch(() => null)
  if (!isWeightManifest(parsed)) {
    return err(kirilyError(KirilyErrorCode.AiInitializationFailed, 'malformed weight manifest'))
  }
  return ok(parsed)
}

const request = async (
  deps: LoadWeightsDeps,
  url: string,
): Promise<Result<Response, KirilyError>> => {
  try {
    const response = await deps.fetch(url)
    if (!response.ok) {
      return err(
        kirilyError(KirilyErrorCode.AiInitializationFailed, `${response.status} for ${url}`),
      )
    }
    return ok(response)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown'
    return err(kirilyError(KirilyErrorCode.AiInitializationFailed, detail))
  }
}

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
