import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode } from '@kirily/contract/error'
import { isWeightManifest, loadWeights } from './weights.ts'

const BYTES = new Uint8Array([10, 20, 30, 40, 50, 60])
/** sha256 of the six bytes above. */
const SHA = 'e0f1b8d4eaa6c09bc4bd44e47f0f8cf00e58ee52a53e8b4a3e1b7c69e3d6f57c'

const manifest = {
  id: 'test',
  bytes: 6,
  sha256: SHA,
  shards: ['w.000', 'w.001', 'w.002'],
  shardBytes: [2, 2, 2],
}

type Options = {
  readonly delay?: Readonly<Record<string, number>>
  readonly manifest?: unknown
  readonly body?: (name: string) => BodyInit
}

/** A server that can be told to answer the shards out of order. */
const server = (options: Options = {}) => {
  let inFlight = 0
  let peak = 0

  const fetch = async (url: string): Promise<Response> => {
    if (url.endsWith('manifest.json')) {
      return new Response(JSON.stringify(options.manifest ?? manifest), {
        headers: { 'content-type': 'application/json' },
      })
    }
    const name = url.slice(url.lastIndexOf('/') + 1)
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, options.delay?.[name] ?? 0))
    inFlight -= 1

    const index = Number(name.slice(-1))
    const slice = BYTES.subarray(index * 2, index * 2 + 2)
    return new Response(options.body?.(name) ?? slice.slice().buffer)
  }

  return { fetch, peak: () => peak }
}

const digest = async (bytes: Uint8Array): Promise<string> =>
  bytes.length === 6 && bytes[0] === 10 && bytes[4] === 50 ? SHA : 'wrong'

describe('isWeightManifest', () => {
  test('accepts a manifest that says how big each shard is', () => {
    expect(isWeightManifest(manifest)).toBe(true)
  })

  test('rejects one without the shard sizes', () => {
    const { shardBytes: _dropped, ...without } = manifest
    expect(isWeightManifest(without)).toBe(false)
  })

  test('rejects one whose sizes do not line up with its shards', () => {
    expect(isWeightManifest({ ...manifest, shardBytes: [2, 4] })).toBe(false)
  })

  test('rejects one whose sizes do not add up to the whole', () => {
    expect(isWeightManifest({ ...manifest, shardBytes: [2, 2, 3] })).toBe(false)
  })
})

describe('loadWeights', () => {
  test('assembles the shards in the manifest order, not the order they arrive', async () => {
    // The last shard answers first: only the offsets decide where bytes land.
    const backend = server({ delay: { 'w.000': 20, 'w.001': 10, 'w.002': 0 } })
    const result = await loadWeights({ fetch: backend.fetch, digest }, '/models/test')
    expect(result.ok && Array.from(result.value)).toEqual([10, 20, 30, 40, 50, 60])
  })

  test('asks for every shard at once', async () => {
    const backend = server({ delay: { 'w.000': 10, 'w.001': 10, 'w.002': 10 } })
    await loadWeights({ fetch: backend.fetch, digest }, '/models/test')
    expect(backend.peak()).toBe(3)
  })

  test('reports progress in bytes, reaching 1', async () => {
    const backend = server()
    const seen: number[] = []
    await loadWeights({ fetch: backend.fetch, digest }, '/models/test', (value) => seen.push(value))
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((value) => value > 0 && value <= 1)).toBe(true)
  })

  test('refuses a shard that is not the size the manifest promised', async () => {
    const backend = server({
      body: (name) => (name === 'w.001' ? new Uint8Array([9]) : new Uint8Array([0, 0])),
    })
    const result = await loadWeights({ fetch: backend.fetch, digest }, '/models/test')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe(KirilyErrorCode.AiInitializationFailed)
  })

  test('refuses weights whose hash does not match', async () => {
    const backend = server()
    const result = await loadWeights(
      { fetch: backend.fetch, digest: async () => 'deadbeef' },
      '/models/test',
    )
    expect(result.ok).toBe(false)
  })

  test('refuses a manifest that is not one', async () => {
    const backend = server({ manifest: { id: 'test' } })
    const result = await loadWeights({ fetch: backend.fetch, digest }, '/models/test')
    expect(result.ok).toBe(false)
  })
})
