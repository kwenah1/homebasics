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
    // API-only tests: no browser needed, hit FastAPI directly.
    { name: 'api', testMatch: /api\/.*\.spec\.ts/, use: { baseURL: API_URL } },
    { name: 'chromium', testIgnore: /api\//, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      testIgnore: /api\//,
      grep: /@mobile/,
      use: { ...devices['Pixel 7'] },
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
