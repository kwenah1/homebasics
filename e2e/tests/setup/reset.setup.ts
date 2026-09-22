/**
 * Runs first, before every other project (see playwright.config.ts).
 *
 * Why: when a project fails, Playwright skips the projects that depend on it - including
 * 'isolated', whose afterEach resets were our only cleanup. A failed run then left stray
 * products/categories behind, and every later run started dirty and failed the catalog's
 * global counts. Resetting at the *start* makes each run independent of the last one.
 */
import { expect, test as setup } from '@playwright/test'

import { API_URL } from '../../support/api'

setup('reset database to the seed state', async ({ request }) => {
  const response = await request.post(`${API_URL}/api/v1/test/reset`)
  expect(response.ok(), 'ENABLE_TEST_ENDPOINTS must be true for E2E').toBeTruthy()
})
