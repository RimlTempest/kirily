import { describe, expect, test } from 'bun:test'
import { ok } from '@kirily/contract/result'
import { KirilyErrorCode } from '@kirily/contract/error'
import type { ModelSpec } from './model-spec.ts'
import type { OnnxProviderDeps, Session } from './onnx-provider.ts'
import { createOnnxProvider } from './onnx-provider.ts'

const spec: ModelSpec = {
  id: 'test-model',
  label: 'test',
  inputSize: 2,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  outputActivation: 'none',
  rescaleOutput: false,
  provenance: { source: 'test', license: 'none' },
}

const WEIGHTS = new Uint8Array([1, 2, 3, 4])
// sha256 of the four bytes above.
const WEIGHTS_SHA = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'

const manifest = {
  id: 'test-model',
  bytes: WEIGHTS.length,
  sha256: WEIGHTS_SHA,
  shards: ['weights.000'],
}

const respond = (body: unknown): Response =>
  body instanceof Uint8Array
    ? new Response(body.slice().buffer)
    : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const deps = (overrides: Partial<OnnxProviderDeps> = {}): OnnxProviderDeps => ({
  weightsBaseUrl: '/models/test-model',
  fetch: async (url) => (url.endsWith('manifest.json') ? respond(manifest) : respond(WEIGHTS)),
  createSession: async () => ok<Session>({ run: async () => new Float32Array([0, 0, 1, 1]) }),
  ...overrides,
})

const image = {
  width: 2,
  height: 2,
  rgba: new Uint8ClampedArray(16).fill(255),
}

describe('createOnnxProvider', () => {
  test('declares that it keeps the image on the device', () => {
    expect(createOnnxProvider(deps(), spec).info.requiresUpload).toBe(false)
  })

  test('downloads the weights, builds a session, and segments', async () => {
    const provider = createOnnxProvider(deps(), spec)

    const ready = await provider.initialize()
    expect(ready.ok).toBe(true)

    const result = await provider.removeBackground(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.from(result.value.alpha)).toEqual([0, 0, 255, 255])
  })

  test('reports progress and ends at 1', async () => {
    const seen: number[] = []
    const provider = createOnnxProvider(deps(), spec)

    await provider.initialize((value) => seen.push(value))

    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  test('builds the session only once across repeated initialise calls', async () => {
    let built = 0
    const provider = createOnnxProvider(
      deps({
        createSession: async () => {
          built += 1
          return ok<Session>({ run: async () => new Float32Array(4) })
        },
      }),
      spec,
    )

    await provider.initialize()
    await provider.initialize()
    expect(built).toBe(1)
  })

  test('fails clearly when the weights are missing', async () => {
    const provider = createOnnxProvider(
      deps({ fetch: async () => new Response('', { status: 404 }) }),
      spec,
    )

    const ready = await provider.initialize()
    expect(ready.ok).toBe(false)
    if (ready.ok) return
    expect(ready.error.code).toBe(KirilyErrorCode.AiInitializationFailed)
  })

  test('refuses weights whose hash does not match the manifest', async () => {
    const provider = createOnnxProvider(
      deps({
        fetch: async (url) =>
          url.endsWith('manifest.json')
            ? respond({ ...manifest, sha256: 'deadbeef' })
            : respond(WEIGHTS),
      }),
      spec,
    )

    const ready = await provider.initialize()
    expect(ready.ok).toBe(false)
    if (ready.ok) return
    expect(ready.error.detail).toContain('sha256')
  })

  test('refuses a manifest that is not one', async () => {
    const provider = createOnnxProvider(
      deps({ fetch: async () => respond({ hello: 'world' }) }),
      spec,
    )
    const ready = await provider.initialize()
    expect(ready.ok).toBe(false)
  })

  test('will not run before it is initialised', async () => {
    const result = await createOnnxProvider(deps(), spec).removeBackground(image)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.AiInferenceFailed)
  })

  test('turns an inference crash into an error value', async () => {
    const provider = createOnnxProvider(
      deps({
        createSession: async () =>
          ok<Session>({
            run: async () => {
              throw new Error('out of GPU memory')
            },
          }),
      }),
      spec,
    )
    await provider.initialize()

    const result = await provider.removeBackground(image)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('out of GPU memory')
  })

  test('rejects an output that is too small to be a mask', async () => {
    const provider = createOnnxProvider(
      deps({ createSession: async () => ok<Session>({ run: async () => new Float32Array(2) }) }),
      spec,
    )
    await provider.initialize()

    const result = await provider.removeBackground(image)
    expect(result.ok).toBe(false)
  })

  test('rejects an image whose buffer does not match its size', async () => {
    const provider = createOnnxProvider(deps(), spec)
    await provider.initialize()

    const result = await provider.removeBackground({
      width: 4,
      height: 4,
      rgba: new Uint8ClampedArray(16),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(KirilyErrorCode.SizeMismatch)
  })
})
