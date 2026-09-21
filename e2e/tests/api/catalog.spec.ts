import { expect, test } from '@playwright/test'

type Item = { sku: string; price_cents: number; stock_status: string; stock_left: number | null }
type Page = { items: Item[]; total: number; pages: number }

const SORTS = ['name', 'price_asc', 'price_desc', 'newest', 'rating']

test.describe('API: catalog contract @api', () => {
  for (const sort of SORTS) {
    test(`walking every page (sort=${sort}) returns each product exactly once`, async ({ request }) => {
      const seen: string[] = []
      let pages = 1
      for (let page = 1; page <= pages; page++) {
        const response = await request.get('/api/v1/products', { params: { sort, page, page_size: 7 } })
        expect(response.status()).toBe(200)
        const body: Page = await response.json()
        pages = body.pages
        seen.push(...body.items.map((p) => p.sku))
      }
      expect(seen).toHaveLength(60)
      expect(new Set(seen).size).toBe(60)
    })
  }

  test('stock_left is only revealed for low stock', async ({ request }) => {
    const body: Page = await (await request.get('/api/v1/products', { params: { page_size: 50 } })).json()
    for (const item of body.items) {
      if (item.stock_status === 'low_stock') {
        expect(item.stock_left).toBeGreaterThanOrEqual(1)
        expect(item.stock_left).toBeLessThanOrEqual(5)
      } else {
        expect(item.stock_left, item.sku).toBeNull()
      }
      expect(item).not.toHaveProperty('stock_qty')
    }
  })

  test('validation errors use the standard error shape', async ({ request }) => {
    const response = await request.get('/api/v1/products', {
      params: { min_price_cents: 500, max_price_cents: 100 },
    })
    expect(response.status()).toBe(422)
    expect((await response.json()).error.code).toBe('validation_error')
  })

  test('catalog is public: no auth header needed', async ({ request }) => {
    for (const path of ['/api/v1/categories', '/api/v1/products', '/api/v1/products/cotton-swabs-500-ct']) {
      expect((await request.get(path)).status(), path).toBe(200)
    }
  })
})
