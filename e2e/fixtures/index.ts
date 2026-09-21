import { test as base, expect } from '@playwright/test'

import { HomePage } from '../pages/HomePage'

const API_URL = process.env.API_URL ?? 'http://localhost:8010'

type Fixtures = {
  homePage: HomePage
  /** Call to put the database back to the deterministic seed state. */
  resetDb: () => Promise<void>
}

export const test = base.extend<Fixtures>({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page))
  },
  resetDb: async ({ request }, use) => {
    await use(async () => {
      const response = await request.post(`${API_URL}/api/v1/test/reset`)
      expect(response.ok(), 'test reset endpoint must be enabled').toBeTruthy()
    })
  },
})

export { expect }
