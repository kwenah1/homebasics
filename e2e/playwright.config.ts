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
      testIgnore: /(api|isolated|setup)\//,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: /(api|isolated|setup)\//,
      grep: /@mobile/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
    {
      // Tests that change global state (server clock, full DB reset) must run alone: this
      // project waits for every other one and runs its files one at a time in one worker.
      // Run just these with: npx playwright test --project=isolated
      name: 'isolated',
      testMatch: /isolated\/.*\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      dependencies: ['api', 'chromium', 'mobile'],
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
      command: 'npm run dev',
      cwd: path.resolve(__dirname, '../frontend'),
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
