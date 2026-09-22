/**
 * Checkout scenarios that fight over the last unit, move the clock or change prices.
 * Serial, in the isolated project, and the database is reset after each.
 */
import { expect, test } from '../../fixtures'
import { addFromProductPage } from '../../pages/CartPage'
import { API_URL } from '../../support/api'

const LAST_UNIT = 'glass-cleaner-26oz' // CLN-005: exactly 1 in stock

test.describe.configure({ mode: 'serial' })

test.afterEach(async ({ api, resetDb }) => {
  await api.resetClock()
  await resetDb()
})

test('two shoppers race for the last unit: one order, one clear refusal (CHK-04)', async ({
  playwright,
  api,
}) => {
  const baseURL = API_URL
  const contexts = await Promise.all([1, 2].map(() => playwright.request.newContext({ baseURL })))
  const shoppers = await Promise.all(
    contexts.map(async (ctx, i) => {
      const email = `race${i}.${Date.now()}@e2e.test`
      const reg = await ctx.post('/api/v1/auth/register', {
        data: { email, password: 'Sparkle123', first_name: 'R', last_name: `${i}` },
      })
      const auth = { Authorization: `Bearer ${(await reg.json()).access_token}` }
      const addr = await ctx.post('/api/v1/me/addresses', {
        headers: auth,
        data: { recipient_name: 'R', line1: '1 Main', city: 'Austin', state: 'TX', postal_code: '78701' },
      })
      const id = await api.productId(LAST_UNIT)
      expect((await ctx.post('/api/v1/cart/items', { headers: auth, data: { product_id: id } })).ok()).toBeTruthy()
      const q = await (await ctx.post('/api/v1/checkout/quote', { headers: auth, data: { address_id: (await addr.json()).id } })).json()
      return { ctx, auth, addressId: (await addr.json()).id, total: q.total_cents }
    }),
  )

  const results = await Promise.all(
    shoppers.map((s, i) =>
      s.ctx.post('/api/v1/checkout/place-order', {
        headers: { ...s.auth, 'Idempotency-Key': `race-${i}-${Date.now()}` },
        data: { address_id: s.addressId, expected_total_cents: s.total },
      }),
    ),
  )
  const statuses = results.map((r) => r.status()).sort()
  expect(statuses).toEqual([201, 409])
  const loser = results.find((r) => r.status() === 409)!
  expect((await loser.json()).error.lines[0]).toMatchObject({ issue: 'out_of_stock', available: 0 })
  await Promise.all(contexts.map((c) => c.dispose()))
})

test('unpaid order expires after 30 minutes and the last unit goes back on sale (ORD-01)', async ({
  page,
  api,
  shopper: _,
  checkoutPage,
  payPage,
  orderPage,
}) => {
  await addFromProductPage(page, LAST_UNIT, 1)
  await checkoutPage.goto()
  const number = await checkoutPage.place()
  await page.goto(`/p/${LAST_UNIT}`)
  await expect(page.getByTestId('stock-badge')).toHaveText('Out of stock')

  await api.advanceClock(30 * 60)
  await page.goto(`/p/${LAST_UNIT}`) // the catalog sweeps expired orders first
  await expect(page.getByTestId('stock-badge')).toHaveText('Only 1 left')

  await orderPage.goto(number)
  await expect(orderPage.status).toHaveText('Expired')
  await expect(orderPage.payNow).toBeHidden()
  await expect(orderPage.cancel).toBeHidden()
  await page.goto(`/orders/${number}/pay`)
  await expect(page).toHaveURL(`/orders/${number}`) // can't pay an expired order
  await expect(payPage.submit).toBeHidden()
})

test('paying after the window closes shows the expired message', async ({
  page,
  api,
  shopper: _,
  checkoutPage,
  payPage,
}) => {
  await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
  await checkoutPage.goto()
  await checkoutPage.place()
  await expect(payPage.countdown).toBeVisible()

  await api.advanceClock(31 * 60) // the page is still open with the old countdown
  await payPage.payWithTestCard('4242')
  await expect(payPage.expired).toBeVisible()
})

test('price changed after the quote: told, re-quoted, then the order goes through', async ({
  page,
  api,
  shopper: _,
  checkoutPage,
}) => {
  await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 2)
  await checkoutPage.goto()
  await expect(checkoutPage.total).toHaveText('$16.79')

  await api.changeProduct('CLN-001', { price_cents: 599 })
  await checkoutPage.placeOrder.click()
  await expect(checkoutPage.error).toContainText('Your total changed')
  await expect(checkoutPage.total).toHaveText('$18.96') // 11.98 + 0.99 tax + 5.99

  await checkoutPage.place()
})
