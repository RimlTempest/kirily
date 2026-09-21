/**
 * Publishing a large binary as static assets.
 *
 * Cloudflare refuses a static asset over 25 MiB (ADR-0007). Both the model
 * weights and the ONNX Runtime's own WebAssembly are larger than that, so both
 * are split here and put back together in the browser by
 * `packages/ai/src/local/onnx/weights.ts`. One format, one loader.
 */
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Under Cloudflare's 25 MiB limit, with room for HTTP overhead. */
export const SHARD_BYTES = 24 * 1024 * 1024

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export type ShardResult = {
  readonly shards: readonly string[]
  readonly shardBytes: readonly number[]
  readonly sha256: string
}

/**
 * Writes `bytes` into `dir` as `<id>.<ext>.NNN` plus a `manifest.json`.
 * The directory is replaced, so a stale shard from a previous version cannot
 * survive and corrupt the reassembled file.
 */
export const publishSharded = async (
  dir: string,
  id: string,
  extension: string,
  bytes: Uint8Array,
  extra: Record<string, unknown> = {},
): Promise<ShardResult> => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const shards: string[] = []
  const shardBytes: number[] = []
  for (let offset = 0, index = 0; offset < bytes.length; offset += SHARD_BYTES, index++) {
    const name = `${id}.${extension}.${String(index).padStart(3, '0')}`
    await writeFile(join(dir, name), bytes.subarray(offset, offset + SHARD_BYTES))
    shards.push(name)
    shardBytes.push(Math.min(SHARD_BYTES, bytes.length - offset))
  }

  const digest = sha256(bytes)
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ id, bytes: bytes.length, sha256: digest, shards, shardBytes, ...extra }, null, 2)}\n`,
  )

  return { shards, shardBytes, sha256: digest }
}

export const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
