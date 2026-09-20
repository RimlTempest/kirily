/**
 * Downloads the segmentation weights and publishes them as static assets.
 *
 * The weights are build input, not source: they are large, they are not ours,
 * and they never change. Keeping them out of git means a clone stays small and
 * the licence of each file is a link rather than a copy.
 *
 * Cloudflare refuses a static asset over 25 MiB, so each model is split into
 * shards with a manifest describing how to put it back together (ADR-0007).
 *
 * Usage:
 *   bun run models:fetch          # download what is missing
 *   bun run models:fetch --force  # re-download everything
 */
import { mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mib, publishSharded, sha256 } from './shard.ts'

type ModelSource = {
  readonly id: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
  readonly license: string
  readonly credit: string
}

/**
 * Both entries are pinned by size and hash. A model that silently changes
 * upstream would change Kirily's output without any code changing, which is
 * the hardest kind of regression to explain.
 */
const MODELS: readonly ModelSource[] = [
  {
    id: 'birefnet-lite',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx',
    bytes: 114_538_221,
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    license: 'MIT',
    credit: 'ZhengPeng7/BiRefNet, ONNX export by onnx-community',
  },
  {
    id: 'isnet-general-use',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    bytes: 178_648_008,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    license: 'Apache-2.0',
    credit: 'xuebinqin/DIS, distributed by danielgatis/rembg',
  },
  {
    id: 'u2netp',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    bytes: 4_574_861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    license: 'Apache-2.0',
    credit: 'xuebinqin/U-2-Net, distributed by danielgatis/rembg',
  },
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/web/static/models')
const force = process.argv.includes('--force')

const alreadyPublished = async (model: ModelSource): Promise<boolean> => {
  const manifestPath = join(outDir, model.id, 'manifest.json')
  const file = Bun.file(manifestPath)
  if (!(await file.exists())) return false

  const manifest: unknown = await file.json().catch(() => null)
  if (typeof manifest !== 'object' || manifest === null) return false
  return Reflect.get(manifest, 'sha256') === model.sha256
}

const download = async (model: ModelSource): Promise<Uint8Array> => {
  console.log(`  fetching ${model.url}`)
  const response = await fetch(model.url)
  if (!response.ok) {
    throw new Error(`${model.id}: ${response.status} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

const publish = async (model: ModelSource, weights: Uint8Array): Promise<void> => {
  const { shards } = await publishSharded(join(outDir, model.id), model.id, 'onnx', weights, {
    license: model.license,
    credit: model.credit,
    source: model.url,
  })
  console.log(`  ${model.id}: ${shards.length} shard(s), ${mib(weights.length)} MiB`)
}

const main = async (): Promise<void> => {
  await mkdir(outDir, { recursive: true })

  for (const model of MODELS) {
    console.log(model.id)

    if (!force && (await alreadyPublished(model))) {
      console.log('  up to date')
      continue
    }

    const weights = await download(model)

    if (weights.length !== model.bytes) {
      throw new Error(
        `${model.id}: expected ${model.bytes} bytes, got ${weights.length}. `
          + 'The upstream file changed — check it, then update tools/fetch-models.ts.',
      )
    }

    const actual = sha256(weights)
    if (actual !== model.sha256) {
      throw new Error(
        `${model.id}: sha256 mismatch.\n  expected ${model.sha256}\n  actual   ${actual}\n`
          + 'The upstream file changed — check it, then update tools/fetch-models.ts.',
      )
    }

    await publish(model, weights)
  }

  const published = await readdir(outDir).catch(() => [])
  console.log(`\nmodels ready in apps/web/static/models (${published.length} model(s))`)
}

await main()
