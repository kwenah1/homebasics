/**
 * Wipes and reseeds the whole database. Lives in the "isolated" project: running it in
 * parallel with other tests deletes their users mid-request (we saw FK violations / 500s).
 */
import { expect, test } from '../../fixtures'
import { API_URL } from '../../support/api'

test('POST /test/reset reseeds deterministic data @api', async ({ request }) => {
  const response = await request.post(`${API_URL}/api/v1/test/reset`)

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({
    reset: true,
    seeded: { tax_rates: 51, users: 3, categories: 6, products: 61 },
  })
})

test('seed customer can sign in right after a reset', async ({ loginPage, accountPage, resetDb }) => {
  await resetDb()
  await loginPage.goto()
  await loginPage.signIn('customer@homebasics.test', 'Customer123')
  await expect(accountPage.heading).toHaveText('Hi, Casey')
})
