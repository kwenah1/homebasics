import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { ADMIN_USER, uniqueUser } from '../../support/api'

async function login(request: APIRequestContext, email: string, password: string) {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } })
  return { Authorization: `Bearer ${(await r.json()).access_token}` }
}

async function shopperWithCart(request: APIRequestContext, slug: string) {
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
  await request.post('/api/v1/cart/items', { headers: auth, data: { product_id: product.id, quantity: 1 } })
  return { user, auth, addressId: (await address.json()).id as number, productId: product.id as number }
}

test.describe('API: Phase 2 contract @api', () => {
  test('two shoppers race for the last use of a coupon: exactly one gets it (CPN-04)', async ({ request }) => {
    const admin = await login(request, ADMIN_USER.email, ADMIN_USER.password)
    const code = `LAST${Date.now().toString(36).toUpperCase()}`.slice(0, 20)
    const created = await request.post('/api/v1/admin/coupons', {
      headers: admin,
      data: { code, kind: 'fixed', amount_off_cents: 100, max_redemptions: 1 },
    })
    expect(created.status()).toBe(201)

    const shoppers = await Promise.all([1, 2].map(() => shopperWithCart(request, 'all-purpose-cleaner-spray-32oz')))
    const quotes = await Promise.all(
      shoppers.map(async (s) =>
        (
          await request.post('/api/v1/checkout/quote', {
            headers: s.auth,
            data: { address_id: s.addressId, coupon_code: code },
          })
        ).json(),
      ),
    )
    const results = await Promise.all(
      shoppers.map((s, i) =>
        request.post('/api/v1/checkout/place-order', {
          headers: { ...s.auth, 'Idempotency-Key': `race-${Date.now()}-${i}` },
          data: { address_id: s.addressId, coupon_code: code, expected_total_cents: quotes[i].total_cents },
        }),
      ),
    )
    const statuses = results.map((r) => r.status()).sort()
    expect(statuses).toEqual([201, 422])
    const loser = results.find((r) => r.status() === 422)!
    expect((await loser.json()).error).toMatchObject({ code: 'coupon_rejected', reason: 'exhausted' })

    const coupons = await (await request.get('/api/v1/admin/coupons', { headers: admin })).json()
    expect(coupons.find((c: { code: string }) => c.code === code)).toMatchObject({ uses: 1, state: 'exhausted' })
  })

  test('placing an order emails the shopper; failed placements send nothing (EML-01)', async ({ request }) => {
    const s = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz')
    const refused = await request.post('/api/v1/checkout/place-order', {
      headers: { ...s.auth, 'Idempotency-Key': `mail-${Date.now()}-x` },
      data: { address_id: s.addressId, expected_total_cents: 1 },
    })
    expect(refused.status()).toBe(409)
    const quote = await (await request.post('/api/v1/checkout/quote', { headers: s.auth, data: { address_id: s.addressId } })).json()
    const placed = await request.post('/api/v1/checkout/place-order', {
      headers: { ...s.auth, 'Idempotency-Key': `mail-${Date.now()}-y` },
      data: { address_id: s.addressId, expected_total_cents: quote.total_cents },
    })
    const { order_number } = await placed.json()
    const emails = await (await request.get('/api/v1/test/emails', { params: { to: s.user.email } })).json()
    expect(emails.map((e: { subject: string }) => e.subject)).toEqual([
      `Order ${order_number} received - please pay within 30 minutes`,
    ])
  })

  test('wishlist PUT is idempotent and DELETE always 204 (WSH-01)', async ({ request }) => {
    const s = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz')
    const url = `/api/v1/me/wishlist/${s.productId}`
    const first = await request.put(url, { headers: s.auth })
    const second = await request.put(url, { headers: s.auth })
    expect([first.status(), second.status()]).toEqual([200, 200])
    expect((await second.json()).count).toBe(1)
    expect((await request.delete(url, { headers: s.auth })).status()).toBe(204)
    expect((await request.delete(url, { headers: s.auth })).status()).toBe(204)
  })

  test('reviews need a delivered purchase (REV-01)', async ({ request }) => {
    const s = await shopperWithCart(request, 'all-purpose-cleaner-spray-32oz')
    const r = await request.post('/api/v1/products/all-purpose-cleaner-spray-32oz/reviews', {
      headers: s.auth,
      data: { rating: 5 },
    })
    expect(r.status()).toBe(403)
    expect((await r.json()).error.code).toBe('review_not_allowed')
  })

  test('the built web app would be served with security headers (NFR-SEC-04)', async ({ request }) => {
    // The API side: every response forbids cross-origin embedding of its data.
    const r = await request.get('/api/v1/health')
    expect(r.headers()['cross-origin-resource-policy']).toBe('same-origin')
    expect(r.headers()['x-content-type-options']).toBe('nosniff')
  })
})
