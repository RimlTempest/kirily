/**
 * Which models are worth offering on this device, best first.
 *
 * Kept apart from the worker that uses it because it is a policy, not
 * plumbing: every entry here is a claim about what a device can run, and each
 * one is cheap to get wrong in a way that costs the user a large download
 * before anything fails.
 */
import type { GpuCapabilities } from './ort-session.ts'
import type { OrtBackend } from './ort-session.ts'
import type { ModelSpec } from './model-spec.ts'
import { BIREFNET_LITE, ISNET_GENERAL, U2NETP } from './model-spec.ts'

export type PlannedModel = {
  readonly spec: ModelSpec
  readonly backend: OrtBackend
}

/**
 * BiRefNet's decoder binds 11 storage buffers in a single shader stage. The
 * WebGPU spec only guarantees 8, and Apple GPUs report 10, so on those
 * machines the model loads and then fails at the first inference.
 */
export const BIREFNET_STORAGE_BUFFERS = 11

export const planModels = (gpu: GpuCapabilities): readonly PlannedModel[] => {
  const planned: PlannedModel[] = []

  if (gpu.available) {
    if (gpu.maxStorageBuffersPerShaderStage >= BIREFNET_STORAGE_BUFFERS) {
      planned.push({ spec: BIREFNET_LITE, backend: 'webgpu' })
    }
    planned.push({ spec: ISNET_GENERAL, backend: 'webgpu' })
  }

  // On the CPU a 1024² model takes tens of seconds and exhausts the 32-bit
  // wasm heap. A coarser mask that arrives beats a better one that does not.
  planned.push({ spec: U2NETP, backend: 'wasm' })

  return planned
}
