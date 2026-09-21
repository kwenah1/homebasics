import { expect, test } from '../fixtures'
import { API_URL } from '../support/api'

test.describe('browse (CAT-01) @catalog', () => {
  test('category from the nav shows its 10 products @smoke @mobile', async ({ page, listPage, isMobile }) => {
    await page.goto('/')
    if (isMobile) {
      await page.getByTestId('category-tile-bath').click()
    } else {
      await page.getByTestId('nav-category-bath').click()
    }
    await listPage.waitForResults()
    await expect(page).toHaveURL('/c/bath')
    await expect(listPage.heading).toHaveText('Bath')
    await expect(listPage.resultCount).toHaveText('10 products')
    await expect(listPage.cards).toHaveCount(10)
  })

  test('all products paginate 20 at a time without overlap', async ({ listPage, page }) => {
    await listPage.goto('/products')
    await expect(listPage.resultCount).toHaveText('60 products')
    await expect(listPage.pageIndicator).toHaveText('Page 1 of 3')
    const first = await listPage.skus()

    await listPage.goToNextPage()
    await expect(page).toHaveURL('/products?page=2')
    const second = await listPage.skus()

    expect(first).toHaveLength(20)
    expect(second).toHaveLength(20)
    expect(first.filter((sku) => second.includes(sku))).toEqual([])
  })

  test('page, sort and filters survive reload and Back', async ({ listPage, page }) => {
    await listPage.goto('/c/kitchen')
    await listPage.sortBy('price_desc')
    await listPage.toggleInStock()
    await expect(page).toHaveURL('/c/kitchen?in_stock=1&sort=price_desc')
    const before = await listPage.skus()

    await page.reload()
    await listPage.waitForResults()
    expect(await listPage.skus()).toEqual(before)
    await expect(page.getByTestId('filter-in-stock')).toBeChecked()
    await expect(listPage.sort).toHaveValue('price_desc')

    await page.goBack()
    await listPage.waitForResults()
    await expect(page).toHaveURL('/c/kitchen?sort=price_desc')
    await expect(page.getByTestId('filter-in-stock')).not.toBeChecked()
  })
})

test.describe('search (CAT-02) @catalog', () => {
  test('header search finds towels in name or description', async ({ listPage, page }) => {
    await page.goto('/')
    await listPage.search('towel')
    await expect(page).toHaveURL('/products?q=towel')
    await expect(listPage.heading).toHaveText('Results for “towel”')
    for (const name of await listPage.cards.getByTestId('product-name').allTextContents()) {
      expect(name.toLowerCase()).toContain('towel')
    }
  })

  test('UI result count agrees with the API', async ({ listPage, request }) => {
    await listPage.goto('/products')
    await listPage.search('bath towel')
    const api = await (await request.get(`${API_URL}/api/v1/products`, { params: { q: 'bath towel' } })).json()
    expect(await listPage.total()).toBe(api.total)
    expect(await listPage.skus()).toEqual(api.items.map((p: { sku: string }) => p.sku))
  })

  test('no results shows the empty state', async ({ listPage }) => {
    await listPage.goto('/products?q=lawnmower')
    await expect(listPage.empty).toContainText('No products match.')
    await expect(listPage.cards).toHaveCount(0)
  })

  test('a lone % is a literal character, not a wildcard', async ({ listPage }) => {
    await listPage.goto('/products')
    await listPage.search('%')
    expect(await listPage.total()).toBeLessThan(5)
  })
})

test.describe('filter & sort (CAT-03) @catalog', () => {
  test('price range is inclusive at both ends ($49.99 - $50.00)', async ({ listPage }) => {
    await listPage.goto('/products')
    await listPage.setPriceRange('49.99', '50')
    await expect(listPage.resultCount).toHaveText('3 products')
    expect(new Set(await listPage.prices())).toEqual(new Set([4999, 5000]))
    await expect(listPage.activeFilters).toContainText('From $49.99')
  })

  test('in-stock only hides the out-of-stock kitchen item', async ({ listPage }) => {
    await listPage.goto('/c/kitchen')
    await expect(listPage.card('KIT-009')).toBeVisible()
    await listPage.toggleInStock()
    await expect(listPage.resultCount).toHaveText('9 products')
    await expect(listPage.card('KIT-009')).toHaveCount(0)
  })

  for (const [sort, check] of [
    ['price_asc', (a: number[]) => a.every((p, i) => i === 0 || a[i - 1] <= p)],
    ['price_desc', (a: number[]) => a.every((p, i) => i === 0 || a[i - 1] >= p)],
  ] as const) {
    test(`sort ${sort} orders the grid`, async ({ listPage }) => {
      await listPage.goto('/products')
      await listPage.sortBy(sort)
      expect(check(await listPage.prices())).toBe(true)
    })
  }

  test('invalid price input is explained, not sent', async ({ listPage, page }) => {
    await listPage.goto('/products')
    await page.getByTestId('filter-min').fill('50')
    await page.getByTestId('filter-max').fill('10')
    await page.getByTestId('filter-apply').click()
    await expect(page.getByTestId('filter-price-error')).toBeVisible()
    await expect(page).toHaveURL('/products')
  })
})

test.describe('product detail & stock (CAT-04, CAT-05) @catalog', () => {
  test('card opens the detail page', async ({ listPage, detailPage, page }) => {
    await listPage.goto('/c/storage')
    const name = await listPage.cards.first().getByTestId('product-name').textContent()
    await listPage.cards.first().getByTestId('product-link').click()
    await expect(detailPage.name).toHaveText(name!)
    await page.getByTestId('breadcrumb-category').click()
    await expect(page).toHaveURL('/c/storage')
  })

  test('out of stock: Add is disabled @mobile', async ({ detailPage }) => {
    await detailPage.goto('dish-drying-rack')
    await expect(detailPage.stock).toHaveText('Out of stock')
    await expect(detailPage.addToCart).toBeDisabled()
    await expect(detailPage.addToCart).toHaveText('Out of stock')
  })

  for (const [slug, text, maxQty] of [
    ['glass-cleaner-26oz', 'Only 1 left', 1],
    ['bamboo-cutting-board', 'Only 5 left', 5],
    ['rubber-cleaning-gloves-3-pairs', 'In stock', 6],
    ['all-purpose-cleaner-spray-32oz', 'In stock', 10],
  ] as const) {
    test(`${slug}: "${text}" and quantity capped at ${maxQty}`, async ({ detailPage }) => {
      await detailPage.goto(slug)
      await expect(detailPage.stock).toHaveText(text)
      await expect(detailPage.quantity.locator('option')).toHaveCount(maxQty)
      await expect(detailPage.addToCart).toBeEnabled()
    })
  }

  test('archived product shows 404 quickly (no retry storm)', async ({ page }) => {
    await page.goto('/p/discontinued-toaster')
    // Regression: the query layer used to retry the 404 three times (~7 s) before giving up.
    await expect(page.getByTestId('not-found')).toBeVisible({ timeout: 2_000 })
  })
})
