import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { uniqueUser } from '../../support/api'

async function shopperWithCart(request: APIRequestContext, slug: string, quantity: number) {
  const user = uniqueUser()
  const reg = await request.post('/api/v1/auth/register', {
    data: { email: user.email, password: user.password, first_name: 'A', last_name: 'B' },
  })
  const auth = { Authorization: `Bearer ${(await reg.json()).access_token}` }
  const address = await request.post('/api/v1/me/addresses', {
    headers: auth,
    data: { recipient_name: 'A B', line1: '1 Main', city: 'Austin', state: 'TX', postal_code: '78701' },
  })
  const product = await (await request.get(`/api/v1/products/${slug}`)).json()
  await request.post('/api/v1/cart/items', { headers: auth, data: { product_id: product.id, quantity } })
  const addressId = (await address.json()).id
  const quote = await (await request.post('/api/v1/checkout/quote', { headers: auth, data: { address_id: addressId } })).json()
  return { auth, addressId, total: quote.total_cents as number }
}

const CARD = { card_number: '4242424242424242', exp_month: 12, exp_year: 2035, cvc: '123', name_on_card: 'A B' }

test.describe('API: checkout contract @api', () => {
  test('three simultaneous place-order calls with one key create exactly one order', async ({ request }) => {
    const { auth, addressId, total } = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz', 1)
    const headers = { ...auth, 'Idempotency-Key': `dbl-${Date.now()}` }
    const body = { address_id: addressId, shipping_method: 'standard', expected_total_cents: total }

    const responses = await Promise.all(
      [1, 2, 3].map(() => request.post('/api/v1/checkout/place-order', { headers, data: body })),
    )
    const numbers = new Set(await Promise.all(responses.map(async (r) => (await r.json()).order_number)))
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 200, 201])
    expect(numbers.size).toBe(1)

    const orders = await (await request.get('/api/v1/orders', { headers: auth })).json()
    expect(orders.total).toBe(1)
  })

  test('three simultaneous payments with one key charge once', async ({ request }) => {
    const { auth, addressId, total } = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz', 1)
    const placed = await (
      await request.post('/api/v1/checkout/place-order', {
        headers: { ...auth, 'Idempotency-Key': `ord-${Date.now()}` },
        data: { address_id: addressId, expected_total_cents: total },
      })
    ).json()
    const headers = { ...auth, 'Idempotency-Key': `pay-${Date.now()}` }
    const responses = await Promise.all(
      [1, 2, 3].map(() => request.post(`/api/v1/orders/${placed.order_number}/pay`, { headers, data: CARD })),
    )
    expect(responses.every((r) => r.status() === 200)).toBe(true)

    const order = await (await request.get(`/api/v1/orders/${placed.order_number}`, { headers: auth })).json()
    expect(order.payments).toHaveLength(1)
    expect(order.status).toBe('paid')
  })

  test('the full card number never appears in any response', async ({ request }) => {
    const { auth, addressId, total } = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz', 1)
    const placed = await (
      await request.post('/api/v1/checkout/place-order', {
        headers: { ...auth, 'Idempotency-Key': `pan-${Date.now()}` },
        data: { address_id: addressId, expected_total_cents: total },
      })
    ).json()
    const paid = await request.post(`/api/v1/orders/${placed.order_number}/pay`, {
      headers: { ...auth, 'Idempotency-Key': `pan-pay-${Date.now()}` },
      data: CARD,
    })
    const detail = await request.get(`/api/v1/orders/${placed.order_number}`, { headers: auth })
    for (const text of [await paid.text(), await detail.text()]) {
      expect(text).not.toContain('4242424242424242')
      expect(text).toContain('"card_last4":"4242"')
    }
  })

  test('decline is 402 and the order stays payable', async ({ request }) => {
    const { auth, addressId, total } = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz', 1)
    const placed = await (
      await request.post('/api/v1/checkout/place-order', {
        headers: { ...auth, 'Idempotency-Key': `dec-${Date.now()}` },
        data: { address_id: addressId, expected_total_cents: total },
      })
    ).json()
    const declined = await request.post(`/api/v1/orders/${placed.order_number}/pay`, {
      headers: { ...auth, 'Idempotency-Key': `dec-pay-${Date.now()}` },
      data: { ...CARD, card_number: '4000000000000002' },
    })
    expect(declined.status()).toBe(402)
    expect((await declined.json()).error).toMatchObject({ code: 'card_declined', can_retry: true })
    const order = await (await request.get(`/api/v1/orders/${placed.order_number}`, { headers: auth })).json()
    expect(order).toMatchObject({ status: 'pending_payment', can_pay: true })
  })
})
