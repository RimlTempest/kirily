import { describe, expect, test } from 'bun:test'
import { KirilyErrorCode, kirilyError } from '@kirily/contract/error'
import { err, ok } from '@kirily/contract/result'
import { createProviderChain } from './chain.ts'
import type { BackgroundRemovalProvider } from './provider.ts'

const image = { width: 1, height: 1, rgba: new Uint8ClampedArray(4) }

const stub = (
  id: string,
  behaviour: { initialize?: 'ok' | 'fail'; run?: 'ok' | 'fail' } = {},
): BackgroundRemovalProvider => ({
  info: { id, label: id, requiresUpload: false },
  initialize: async () =>
    behaviour.initialize === 'fail'
      ? err(kirilyError(KirilyErrorCode.AiInitializationFailed, id))
      : ok(undefined),
  removeBackground: async () =>
    behaviour.run === 'fail'
      ? err(kirilyError(KirilyErrorCode.AiInferenceFailed, id))
      : ok({ width: 1, height: 1, alpha: new Uint8Array([id.length]) }),
})

describe('createProviderChain', () => {
  test('uses the first candidate that loads', async () => {
    const chain = createProviderChain([stub('big'), stub('small')])
    await chain.initialize()
    expect(chain.info.id).toBe('big')
  })

  test('falls through to the next when the first cannot load', async () => {
    const chain = createProviderChain([stub('big', { initialize: 'fail' }), stub('small')])

    const ready = await chain.initialize()
    expect(ready.ok).toBe(true)
    expect(chain.info.id).toBe('small')
  })

  test('reports which candidate was skipped and why', async () => {
    const skipped: string[] = []
    const chain = createProviderChain([stub('big', { initialize: 'fail' }), stub('small')], {
      onFallback: (from) => skipped.push(from),
    })

    await chain.initialize()
    expect(skipped).toEqual(['big'])
  })

  test('steps down when a loaded model fails on an actual image', async () => {
    const chain = createProviderChain([stub('big', { run: 'fail' }), stub('small')])
    await chain.initialize()

    const result = await chain.removeBackground(image)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.from(result.value.alpha)).toEqual(['small'.length])
  })

  test('returns the original failure when nothing else can run', async () => {
    const chain = createProviderChain([stub('only', { run: 'fail' })])
    await chain.initialize()

    const result = await chain.removeBackground(image)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toBe('only')
  })

  test('fails when no candidate loads at all', async () => {
    const chain = createProviderChain([
      stub('a', { initialize: 'fail' }),
      stub('b', { initialize: 'fail' }),
    ])

    const ready = await chain.initialize()
    expect(ready.ok).toBe(false)
  })

  test('initialises on demand when removeBackground is called first', async () => {
    const chain = createProviderChain([stub('only')])
    const result = await chain.removeBackground(image)
    expect(result.ok).toBe(true)
  })

  test('refuses to be built empty', () => {
    expect(() => createProviderChain([])).toThrow()
  })
})
