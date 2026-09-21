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
 * Every entry is pinned three ways: the URL names a commit rather than a
 * branch, and the bytes are checked against a size and a SHA-256. A model that
 * silently changed upstream would change Kirily's output with no code change,
 * which is the hardest kind of regression to explain — and `resolve/main` is a
 * moving reference in exactly the way a git tag is (ADR-0009).
 */
const MODELS: readonly ModelSource[] = [
  {
    id: 'birefnet-lite',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx',
    bytes: 114_538_221,
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    license: 'MIT',
    credit: 'ZhengPeng7/BiRefNet, ONNX export by onnx-community',
  },
  {
    id: 'isnet-general-use',
    // The fp16 export, 84 MiB against the original's 170. This tier only ever
    // runs on WebGPU (`plan.ts`), which is where half precision is native, so
    // the download is halved for nothing given up — verified against the fp32
    // weights on the evaluation set before the swap (ADR-0014).
    url: 'https://huggingface.co/imgly/isnet-general-onnx/resolve/440dea96dd4a3b06bbbf5abec3e26569dd7ec49f/onnx/model_fp16.onnx',
    bytes: 88_152_708,
    sha256: '2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20',
    license: 'MIT',
    credit: 'xuebinqin/DIS, fp16 ONNX export by IMG.LY',
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
