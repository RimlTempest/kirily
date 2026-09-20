import { describe, expect, test } from 'bun:test'
import { BIREFNET_STORAGE_BUFFERS, planModels } from './plan.ts'
import { NO_GPU } from './ort-session.ts'

const gpu = (maxStorageBuffersPerShaderStage: number) => ({
  available: true,
  maxStorageBuffersPerShaderStage,
})

const ids = (capabilities: Parameters<typeof planModels>[0]): string[] =>
  planModels(capabilities).map((planned) => planned.spec.id)

describe('planModels', () => {
  test('offers only the CPU model when there is no GPU', () => {
    expect(ids(NO_GPU)).toEqual(['u2netp'])
  })

  test('skips BiRefNet on a GPU that cannot bind enough storage buffers', () => {
    // What an Apple GPU reports. Offering BiRefNet here costs a 109 MiB
    // download and then fails on the first inference.
    expect(ids(gpu(10))).toEqual(['isnet-general-use', 'u2netp'])
  })

  test('offers BiRefNet first on a GPU that can run it', () => {
    expect(ids(gpu(BIREFNET_STORAGE_BUFFERS))).toEqual([
      'birefnet-lite',
      'isnet-general-use',
      'u2netp',
    ])
  })

  test('treats the WebGPU spec minimum as not enough', () => {
    expect(ids(gpu(8))).not.toContain('birefnet-lite')
  })

  test('always ends with a model that needs no GPU', () => {
    for (const capabilities of [NO_GPU, gpu(8), gpu(10), gpu(16)]) {
      expect(planModels(capabilities).at(-1)?.backend).toBe('wasm')
    }
  })

  test('never puts a 1024² model on the CPU', () => {
    for (const capabilities of [NO_GPU, gpu(8), gpu(10), gpu(16)]) {
      const onCpu = planModels(capabilities).filter((planned) => planned.backend === 'wasm')
      expect(onCpu.every((planned) => planned.spec.inputSize <= 512)).toBe(true)
    }
  })
})
