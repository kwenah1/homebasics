import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke tests for a *deployed* environment (OPS-02). No web server is started and nothing is
 * seeded or reset: these run against whatever is live, so they must stay read-only.
 *
 *   BASE_URL=https://homebasics.vercel.app npm run test:deployed
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:4173'

export default defineConfig({
  testDir: './tests/deployed',
  // A sleeping free-tier machine takes a moment to wake on the first request.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'deployed', use: { ...devices['Desktop Chrome'] } }],
})
