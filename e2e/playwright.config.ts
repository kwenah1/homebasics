import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.API_URL ?? 'http://localhost:8010'
const backendDir = path.resolve(__dirname, '../backend')
const python = path.join(
  backendDir,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)

export default defineConfig({
  testDir: './tests',
  // 30 s (the default) is tight here: every request crosses the network to Neon, and with
  // three engines a cold browser launch can eat most of the budget before the first byte.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Always first: put the database in the seed state so no run depends on the last one.
    { name: 'setup', testMatch: /setup\/.*\.setup\.ts/ },
    // API-only tests: no browser needed, hit FastAPI directly.
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { baseURL: API_URL },
    },
    {
      name: 'chromium',
      testIgnore: /(api|isolated|setup|deployed)\//,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: /(api|isolated|setup|deployed)\//,
      grep: /@mobile/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
    // Cross-browser (M10): the critical journeys on the other two engines. Running the whole
    // suite three times would mostly re-test our own logic; what differs between engines is
    // rendering, form controls, storage and cookies - which is what @smoke covers.
    {
      name: 'firefox',
      testIgnore: /(api|isolated|setup|deployed)\//,
      grep: /@smoke|@crossbrowser/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /(api|isolated|setup|deployed)\//,
      grep: /@smoke|@crossbrowser/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Safari'] },
    },
    {
      // Tests that change global state (server clock, full DB reset) must run alone: this
      // project waits for every other one and runs its files one at a time in one worker.
      // Run just these with: npx playwright test --project=isolated
      name: 'isolated',
      testMatch: /isolated\/.*\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      dependencies: ['api', 'chromium', 'mobile', 'firefox', 'webkit'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Starts both servers unless they're already running (e.g. from the IDE).
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --port 8010`,
      cwd: backendDir,
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // CI runs against the *built* app, like production: no on-demand compiling (the first
      // page load used to race the dev server's first build and time out), and the real
      // Content-Security-Policy is exercised. Locally, the dev server stays for fast edits.
      command: process.env.CI
        ? 'npm run build && npm run preview -- --port 5173 --strictPort'
        : 'npm run dev',
      cwd: path.resolve(__dirname, '../frontend'),
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
