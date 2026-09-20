/**
 * Fails the build when a static asset is too large to deploy.
 *
 * Cloudflare refuses an individual static asset over 25 MiB. The ONNX Runtime
 * ships several WebAssembly builds and two of them are over that line, so
 * which runtime entry point Kirily imports is a deployment constraint, not a
 * preference (ADR-0007). Without this check the mistake surfaces as a failed
 * deploy long after the change that caused it.
 */
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIMIT = 25 * 1024 * 1024

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/web/.svelte-kit/cloudflare')

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

const files = await walk(outDir)
if (files.length === 0) {
  throw new Error(`No build output in ${relative(root, outDir)}. Run 'bun run build' first.`)
}

const oversized: { path: string; bytes: number }[] = []
let largest = { path: '', bytes: 0 }

for (const file of files) {
  const { size } = await stat(file)
  if (size > largest.bytes) largest = { path: relative(outDir, file), bytes: size }
  if (size > LIMIT) oversized.push({ path: relative(outDir, file), bytes: size })
}

const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2)

if (oversized.length > 0) {
  for (const file of oversized) {
    console.error(`${file.path} is ${mib(file.bytes)} MiB, over Cloudflare's 25 MiB asset limit`)
  }
  console.error(
    '\nSplit it into shards (see tools/shard.ts) or pick a smaller dependency. ADR-0007 has the ONNX Runtime case.',
  )
  process.exit(1)
}

console.log(
  `assets ok: ${files.length} files, largest ${largest.path} at ${mib(largest.bytes)} MiB`,
)
