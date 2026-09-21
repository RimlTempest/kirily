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
import type { Recorder } from '@kirily/contract/timing'
import { Stage } from '@kirily/contract/timing'

export type WeightManifest = {
  readonly id: string
  /** Total size of the reassembled file. */
  readonly bytes: number
  /** SHA-256 of the reassembled file, lowercase hex. */
  readonly sha256: string
  /** Shard file names, in order. Relative to the manifest. */
  readonly shards: readonly string[]
  /**
   * How many bytes each shard holds, in the same order.
   *
   * This is what lets every shard be asked for at once: with the sizes known
   * up front each one knows where it belongs, so the order they come back in
   * stops mattering. Fetching them one after another left 83% of the quality
   * model's load time in the download (ADR-0017).
   */
  readonly shardBytes: readonly number[]
}

export type FetchLike = (input: string) => Promise<Response>

export type LoadWeightsDeps = {
  readonly fetch: FetchLike
  /** Injected so the loader can be tested without WebCrypto. */
  readonly digest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>
  /**
   * Where the two halves report to. Downloading and hashing 84 MiB are very
   * different problems, and "loading is slow" does not say which one to fix.
   */
  readonly record?: Recorder
}

export const isWeightManifest = (value: unknown): value is WeightManifest => {
  if (typeof value !== 'object' || value === null) return false
  if (typeof Reflect.get(value, 'id') !== 'string') return false
  if (typeof Reflect.get(value, 'sha256') !== 'string') return false

  const total: unknown = Reflect.get(value, 'bytes')
  const shards: unknown = Reflect.get(value, 'shards')
  const sizes: unknown = Reflect.get(value, 'shardBytes')
  if (typeof total !== 'number') return false
  if (!Array.isArray(shards) || !shards.every((shard) => typeof shard === 'string')) return false
  if (!Array.isArray(sizes) || !sizes.every((size) => typeof size === 'number')) return false

  // A manifest that disagrees with itself would place shards at the wrong
  // offsets and produce a plausible, wrong model rather than an error.
  if (sizes.length !== shards.length) return false
  return sizes.reduce((sum: number, size: number) => sum + size, 0) === total
}

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
  const sizes = manifest.value.shardBytes

  // Where each shard belongs, worked out before any of them is asked for.
  const offsets: number[] = []
  let running = 0
  for (const size of sizes) {
    offsets.push(running)
    running += size
  }

  let written = 0
  const report = (added: number): void => {
    written += added
    onProgress?.(written / total)
  }

  const startedFetch = now()
  const fetched = await Promise.all(
    manifest.value.shards.map(async (shard, index) =>
      readShard(
        deps,
        `${baseUrl}/${shard}`,
        weights,
        offsets[index] ?? 0,
        sizes[index] ?? 0,
        report,
      ),
    ),
  )
  deps.record?.(Stage.AiFetch, now() - startedFetch)

  for (const outcome of fetched) {
    if (!outcome.ok) return outcome
  }

  const digest = deps.digest ?? sha256Hex
  const startedVerify = now()
  const actual = await digest(weights)
  deps.record?.(Stage.AiVerify, now() - startedVerify)
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

/**
 * Streams one shard straight into its slice of the destination.
 *
 * Reading the body in chunks rather than as one `ArrayBuffer` is what keeps
 * asking for every shard at once affordable: four 24 MiB buffers in flight
 * would double the peak on a phone, and this way the only full copy is the one
 * the runtime is going to be handed anyway. It also makes progress byte-exact
 * for free.
 */
const readShard = async (
  deps: LoadWeightsDeps,
  url: string,
  into: Uint8Array,
  offset: number,
  expected: number,
  report: (added: number) => void,
): Promise<Result<void, KirilyError>> => {
  const response = await request(deps, url)
  if (!response.ok) return response

  let written = 0
  const body = response.value.body
  if (body === null) {
    // No stream available: fall back to the whole body at once.
    const buffer = new Uint8Array(await response.value.arrayBuffer())
    written = buffer.length
    if (written === expected) into.set(buffer, offset)
    report(Math.min(written, expected))
  } else {
    const reader = body.getReader()
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      const piece = chunk.value
      if (written + piece.length > expected) {
        written += piece.length
        break
      }
      into.set(piece, offset + written)
      written += piece.length
      report(piece.length)
    }
  }

  if (written !== expected) {
    // A short or long shard would land the rest of the model at the wrong
    // offsets, which produces nonsense rather than a failure.
    return err(
      kirilyError(
        KirilyErrorCode.AiInitializationFailed,
        `shard ${url.slice(url.lastIndexOf('/') + 1)}: expected ${expected} bytes, got ${written}`,
      ),
    )
  }
  return ok(undefined)
}

/** `performance` exists in workers and in Node; a missing one must not break loading. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now())

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
