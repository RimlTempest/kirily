import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * An image editor that only works with a mouse excludes people who cannot use
 * one — and the E2E suite itself depends on roles and accessible names, so a
 * regression here breaks the tests too.
 */

const fixture = fileURLToPath(new URL('../../fixtures/subject-on-white.png', import.meta.url))

const scan = async (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()

test('the landing page has no accessibility violations', async ({ page }) => {
  await page.goto('/')
  const results = await scan(page)
  expect(results.violations).toEqual([])
})

test('the editor has no accessibility violations with an image open', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()

  const results = await scan(page)
  expect(results.violations).toEqual([])
})

test('every control is reachable and operable from the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('編集する画像を選ぶ').setInputFiles(fixture)
  await expect(page.getByLabel('編集中の画像')).toBeVisible()

  await page.getByRole('button', { name: '背景をきりり' }).focus()
  await page.keyboard.press('Enter')
  // The wait is on the status line, not a timeout: how long removal takes
  // depends on which model tier the device runs.
  await expect(page.getByText(/高精度モデル|軽量モデル|簡易処理/)).toBeVisible({
    timeout: 300_000,
  })
  await expect(page.getByRole('button', { name: '取り消す' })).toBeEnabled()

  // Cmd/Ctrl+Z is the shortcut every editor has; losing it is a regression.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('button', { name: '取り消す' })).toBeDisabled()
})
