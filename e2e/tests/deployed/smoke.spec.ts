/**
 * Deployed smoke tests (OPS-02): is the live site actually serving shoppers?
 *
 * Read-only on purpose - this runs against production after every deploy and on a schedule,
 * so it browses, checks the API and the security headers, and never writes anything.
 */
import { expect, test } from '@playwright/test'

// 'prod' for the real deployment; set EXPECT_ENVIRONMENT=dev to dry-run against a local build.
const EXPECTED_ENVIRONMENT = process.env.EXPECT_ENVIRONMENT ?? 'prod'

test.describe('deployed storefront @smoke', () => {
  test('the API is healthy and talking to its database', async ({ request }) => {
    const response = await request.get('/api/v1/health')
    expect(response.ok()).toBeTruthy()
    const health = await response.json()
    expect(health).toMatchObject({ status: 'ok', database: 'ok', environment: EXPECTED_ENVIRONMENT })
  })

  test('test-only endpoints are not exposed', async ({ request }) => {
    test.skip(EXPECTED_ENVIRONMENT !== 'prod', 'dev and test deliberately expose /test/*')
    // ENABLE_TEST_ENDPOINTS can't be on in prod - prove it from the outside.
    for (const path of ['/api/v1/test/reset', '/api/v1/test/emails?to=a@b.test']) {
      expect((await request.fetch(path, { method: 'POST' })).status()).toBe(404)
    }
    const spec = await (await request.get('/api/v1/openapi.json')).json()
    expect(Object.keys(spec.paths).filter((p) => p.includes('/test/'))).toEqual([])
  })

  test('security headers are served (NFR-SEC-04)', async ({ request }) => {
    const page = (await request.get('/')).headers()
    expect(page['content-security-policy']).toContain("default-src 'self'")
    expect(page['x-content-type-options']).toBe('nosniff')
    expect(page['x-frame-options']).toBe('DENY')

    const api = (await request.get('/api/v1/health')).headers()
    expect(api['cross-origin-resource-policy']).toBe('same-origin')
    expect(api['x-content-type-options']).toBe('nosniff')
  })

  test('home page shows the catalog', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('[data-testid^="category-tile-"]')).toHaveCount(6)
    await expect(page.getByTestId('api-status')).toHaveAttribute('data-state', 'online')
  })

  test('browse, search and open a product', async ({ page }) => {
    await page.goto('/products')
    const cards = page.getByTestId('product-card')
    await expect(cards.first()).toBeVisible()

    await page.goto('/products?q=towel')
    await expect(cards.first()).toContainText(/towel/i)

    await cards.first().click()
    await expect(page.getByTestId('detail-price')).toContainText('$')
    await expect(page.getByTestId('add-to-cart')).toBeVisible()
    await expect(page.getByTestId('reviews')).toBeVisible()
  })

  test('a guest can fill a cart', async ({ page }) => {
    await page.goto('/products')
    await page.getByTestId('product-card').first().click()
    await page.getByTestId('add-to-cart').click()
    await expect(page.getByTestId('cart-count')).toHaveText('1')
    await page.goto('/cart')
    await expect(page.getByTestId('cart-line')).toHaveCount(1)
    await expect(page.getByTestId('checkout').first()).toBeVisible() // guests sign in next
  })

  test('sign-in page is reachable', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})
