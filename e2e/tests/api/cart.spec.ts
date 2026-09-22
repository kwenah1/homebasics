import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { uniqueUser } from '../../support/api'

async function signUp(request: APIRequestContext) {
  const user = uniqueUser()
  const response = await request.post('/api/v1/auth/register', {
    data: { email: user.email, password: user.password, first_name: 'A', last_name: 'B' },
  })
  return { Authorization: `Bearer ${(await response.json()).access_token}` }
}

async function productId(request: APIRequestContext, slug: string): Promise<number> {
  return (await (await request.get(`/api/v1/products/${slug}`)).json()).id
}

test.describe('API: cart contract @api', () => {
  test('concurrent adds for one shopper are serialised: no 500s, never over the limit', async ({
    request,
  }) => {
    const auth = await signUp(request)
    const spray = await productId(request, 'all-purpose-cleaner-spray-32oz')

    // Six simultaneous "add 2" requests: only five fit under the 10-per-line limit.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request.post('/api/v1/cart/items', { headers: auth, data: { product_id: spray, quantity: 2 } }),
      ),
    )
    const statuses = responses.map((r) => r.status()).sort()
    expect(statuses).toEqual([200, 200, 200, 200, 200, 409])

    const cart = await (await request.get('/api/v1/cart', { headers: auth })).json()
    expect(cart.items).toHaveLength(1)
    expect(cart.items[0].quantity).toBe(10)
  })

  test('preview of a guest cart equals the saved cart for the same lines', async ({ request }) => {
    const auth = await signUp(request)
    const lines = [
      { product_id: await productId(request, 'nonstick-frying-pan-10in'), quantity: 2 },
      { product_id: await productId(request, 'bamboo-cutting-board'), quantity: 5 },
    ]
    for (const line of lines) {
      expect((await request.post('/api/v1/cart/items', { headers: auth, data: line })).ok()).toBeTruthy()
    }
    const saved = await (await request.get('/api/v1/cart', { headers: auth })).json()
    const preview = await (await request.post('/api/v1/cart/preview', { data: { items: lines } })).json()
    expect(preview).toEqual(saved)
  })

  test('merge is reported, and the report adds up', async ({ request }) => {
    const auth = await signUp(request)
    const board = await productId(request, 'bamboo-cutting-board') // stock 5
    await request.post('/api/v1/cart/items', { headers: auth, data: { product_id: board, quantity: 3 } })

    const body = await (
      await request.post('/api/v1/cart/merge', {
        headers: auth,
        data: { items: [{ product_id: board, quantity: 4 }] },
      })
    ).json()
    expect(body.report.capped).toEqual([{ product_id: board, requested: 7, kept: 5 }])
    expect(body.cart.items[0].quantity).toBe(5)
  })

  test('saved-cart endpoints require a token; preview does not', async ({ request }) => {
    expect((await request.get('/api/v1/cart')).status()).toBe(401)
    expect((await request.post('/api/v1/cart/items', { data: { product_id: 1 } })).status()).toBe(401)
    expect((await request.post('/api/v1/cart/preview', { data: { items: [] } })).status()).toBe(200)
  })
})
