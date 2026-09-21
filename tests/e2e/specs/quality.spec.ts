import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boundaryFScore,
  defaultTolerance,
  iou,
  meanAbsoluteError,
} from '@kirily/image-core/metrics'
import type { Case } from '../../fixtures/cases.ts'
import { evaluationCases } from '../../fixtures/cases.ts'
import { encodePng } from '../../fixtures/png.ts'

/**
 * What the cutout is actually worth, as three numbers per case.
 *
 * The rest of the suite asks whether a feature works. This asks how well, on
 * images whose correct alpha is arithmetic rather than opinion
 * (`tests/fixtures/cases.ts`), and compares the answer to `baselines.json`.
 *
 * It is a ratchet, not a target: a score may not fall by more than MARGIN, and
 * an improvement is expected to be written back. That is what makes a claim
 * like "matting helps hair" checkable instead of asserted.
 *
 * Scores are recorded per Playwright project, because the project decides
 * which tier runs: `desktop` has no GPU adapter and gets U²-Netp, while
 * `desktop-webgpu` gets whatever the machine's limits allow. Comparing the two
 * files is how a claim about a tier is checked.
 */

const BASELINES = fileURLToPath(new URL('../baselines.json', import.meta.url))

/** How far a score may drift before it counts as a regression. */
const MARGIN = 0.02

type Scores = { iou: number; boundary: number; mae: number }
/** Project name -> case name -> scores. */
type Baselines = Record<string, Record<string, Scores>>

const modelsPublished = async (page: Page): Promise<boolean> =>
  (await page.request.get('/models/u2netp/manifest.json')).ok()

/** Runs the chain and returns which tier answered, so a baseline names its model. */
const removeBackground = async (page: Page): Promise<string> => {
  await page.getByRole('button', { name: '背景をきりり' }).click()
  const tier = page.getByText(/高精度モデル|軽量モデル/)
  await expect(tier).toBeVisible({ timeout: 300_000 })
  await expect(page.getByText('簡易処理')).toBeHidden()
  return (await tier.textContent()) ?? ''
}

/** The alpha channel of the exported PNG — the real answer, at full resolution. */
const exportedAlpha = async (page: Page, size: number): Promise<Uint8Array> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG で書き出す' }).click()
  const path = await (await download).path()

  const encoded = await page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) return ''
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

      const alpha = new Uint8Array(bitmap.width * bitmap.height)
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3] ?? 0
      // Base64, not an array: 147k numbers as JSON is slower than the encode.
      let binary = ''
      for (const value of alpha) binary += String.fromCharCode(value)
      return btoa(binary)
    },
    Array.from(await readFile(path)),
  )

  const decoded = Buffer.from(encoded, 'base64')
  expect(decoded.length).toBe(size * size)
  return new Uint8Array(decoded)
}

const score = (predicted: Uint8Array, subject: Case): Scores => {
  const size = { width: subject.width, height: subject.height }
  const overlap = iou(predicted, subject.alpha)
  const boundary = boundaryFScore(predicted, subject.alpha, size, defaultTolerance(size))
  const error = meanAbsoluteError(predicted, subject.alpha)
  expect(overlap.ok && boundary.ok && error.ok).toBe(true)
  return {
    iou: overlap.ok ? overlap.value : 0,
    boundary: boundary.ok ? boundary.value : 0,
    mae: error.ok ? error.value : 1,
  }
}

const round = (value: number): number => Math.round(value * 1000) / 1000

test.describe('cutout quality', () => {
  const recorded: Baselines = {}

  test.afterAll(async () => {
    if (process.env['KIRILY_UPDATE_BASELINES'] !== '1') return
    if (Object.keys(recorded).length === 0) return
    const existing: Baselines = JSON.parse(await readFile(BASELINES, 'utf8').catch(() => '{}'))
    const merged: Baselines = { ...existing }
    for (const [project, scores] of Object.entries(recorded)) {
      merged[project] = { ...existing[project], ...scores }
    }
    await writeFile(BASELINES, `${JSON.stringify(merged, null, 2)}\n`)
  })

  for (const subject of evaluationCases()) {
    test(`${subject.name}: ${subject.catches}`, async ({ page }, testInfo) => {
      // Mobile would run the same CPU tier on a smaller viewport: the same
      // numbers at twice the wall-clock cost.
      test.skip(testInfo.project.name === 'mobile', 'the desktop project covers this tier')
      test.slow()

      await page.goto('/')
      test.skip(!(await modelsPublished(page)), "run 'bun run models:fetch' first")

      const directory = await mkdtemp(join(tmpdir(), 'kirily-quality-'))
      const file = join(directory, `${subject.name}.png`)
      await writeFile(file, encodePng(subject.rgb, subject.width, subject.height, 3))

      await page.getByLabel('編集する画像を選ぶ').setInputFiles(file)
      await expect(page.getByLabel('編集中の画像')).toBeVisible()
      const tier = await removeBackground(page)

      const scores = score(await exportedAlpha(page, subject.width), subject)
      const project = testInfo.project.name
      recorded[project] = {
        ...recorded[project],
        [subject.name]: {
          iou: round(scores.iou),
          boundary: round(scores.boundary),
          mae: round(scores.mae),
        },
      }
      await testInfo.attach(`${subject.name}-scores`, {
        body: JSON.stringify({ tier, ...recorded[project]?.[subject.name] }, null, 2),
        contentType: 'application/json',
      })

      if (process.env['KIRILY_UPDATE_BASELINES'] === '1') return

      const baselines: Baselines = JSON.parse(await readFile(BASELINES, 'utf8'))
      const baseline = baselines[project]?.[subject.name]
      expect(baseline, `no baseline for ${project}/${subject.name}`).toBeDefined()
      if (baseline === undefined) return

      expect(scores.iou).toBeGreaterThan(baseline.iou - MARGIN)
      expect(scores.boundary).toBeGreaterThan(baseline.boundary - MARGIN)
      expect(scores.mae).toBeLessThan(baseline.mae + MARGIN)
    })
  }
})
