import { defineConfig, devices } from '@playwright/test'

/**
 * Desktop and mobile are separate products in Kirily, not one layout at two
 * widths (kirily-design.md §15). Both run on every change, so a change to one
 * cannot quietly break the other.
 *
 * iOS Safari is the browser most likely to break the Canvas and encoder paths,
 * so it has its own project — but the WebKit build Playwright ships does not
 * run on every machine (it crashes on some Apple Silicon setups). It is opt-in
 * via `KIRILY_E2E_WEBKIT=1` rather than silently skipped, so nobody believes
 * they have Safari coverage when they do not.
 */
/**
 * Not 4173. That is Vite's default, so every other project on the machine is
 * a candidate to be sitting on it, and `reuseExistingServer` cannot tell the
 * difference between our preview server and someone else's.
 */
const PORT = 4319

const webkit = process.env['KIRILY_E2E_WEBKIT'] === '1'

/**
 * The WebGPU tiers need a real adapter, which a CI runner does not have — and
 * headless Chromium hands back `navigator.gpu` with no adapter behind it, so a
 * silent skip would look like coverage. Opt in with `bun run e2e:webgpu` on a
 * machine with a GPU.
 */
const webgpu = process.env['KIRILY_E2E_WEBGPU'] === '1'

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['html'], ['github']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    ...(webgpu
      ? [
          {
            name: 'desktop-webgpu',
            use: {
              ...devices['Desktop Chrome'],
              launchOptions: { args: ['--use-angle=metal', '--enable-unsafe-webgpu'] },
            },
          },
        ]
      : []),
    ...(webkit ? [{ name: 'mobile-safari', use: { ...devices['iPhone 15'] } }] : []),
  ],
  webServer: {
    command: `bun run --filter @kirily/web preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Reused for speed, which is only safe because the port is ours. On 4173,
    // Vite's default, a preview server from another project answered and a
    // whole run went green against somebody else's 404 page.
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
