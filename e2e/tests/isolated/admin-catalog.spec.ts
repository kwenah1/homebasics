/**
 * Catalog-changing back-office tests (ADM-01, ADM-01b, ADM-02). They add products and
 * categories, which would break the parallel catalog tests' global counts - so they run in
 * the serial isolated project and the database is reset after each.
 */
import { addFromProductPage } from '../../pages/CartPage'
import { expect, test } from '../../fixtures'
import { createProductInUi, signInAsAdmin, tag } from '../../support/admin'

test.describe.configure({ mode: 'serial' })

test.afterEach(async ({ resetDb }) => {
  await resetDb()
})

test.describe('products & stock (ADM-01, ADM-02) @admin', () => {
  test('create a product: it is on sale immediately @smoke', async ({ page, browser }) => {
    await signInAsAdmin(page)
    const product = await createProductInUi(page, { price: '6.49', stock: '3' })

    const shopper = await (await browser.newContext()).newPage()
    await shopper.goto(`/p/${product.slug}`)
    await expect(shopper.getByTestId('detail-name')).toHaveText(product.name)
    await expect(shopper.getByTestId('detail-price')).toHaveText('$6.49')
    await expect(shopper.getByTestId('stock-badge')).toHaveText('Only 3 left')
    await shopper.context().close()
  })

  test('restock, damage and the ledger that explains every unit', async ({ page }) => {
    await signInAsAdmin(page)
    await createProductInUi(page, { price: '6.49', stock: '3' })

    await page.getByTestId('admin-adjust-reason').selectOption('restock')
    await page.getByTestId('admin-adjust-amount').fill('20')
    await page.getByTestId('admin-adjust-note').fill('PO-778')
    await page.getByTestId('admin-adjust-submit').click()
    await expect(page.getByTestId('admin-stock-qty')).toHaveText('23')

    await page.getByTestId('admin-adjust-reason').selectOption('damaged')
    await page.getByTestId('admin-adjust-amount').fill('2')
    await page.getByTestId('admin-adjust-submit').click()
    await expect(page.getByTestId('admin-stock-qty')).toHaveText('21')

    await expect(page.getByTestId('admin-ledger-row')).toHaveCount(3)
    await expect(page.getByTestId('admin-ledger-row').first()).toContainText('-2')
    await expect(page.getByTestId('admin-ledger-check')).toHaveText('Ledger total 21 = stock ✓')

    await page.getByTestId('admin-adjust-reason').selectOption('damaged')
    await page.getByTestId('admin-adjust-amount').fill('50')
    await page.getByTestId('admin-adjust-submit').click()
    await expect(page.getByTestId('admin-notice')).toContainText("Only 21 in stock; can't remove 50.")
  })

  test('price change reaches the store and flags carts (CRT-03)', async ({ page, browser }) => {
    await signInAsAdmin(page)
    const product = await createProductInUi(page, { price: '6.49', stock: '10' })

    const shopper = await (await browser.newContext()).newPage()
    await addFromProductPage(shopper, product.slug, 1)

    await page.getByTestId('admin-edit-price').fill('7.25')
    await page.getByTestId('admin-save-details').click()
    await expect(page.getByTestId('admin-notice')).toHaveText('Saved.')

    await shopper.goto('/cart')
    await expect(shopper.getByTestId('line-price-change')).toHaveText('Price went up from $6.49 to $7.25')
    await shopper.context().close()
  })

  test('archive hides it from the store; unarchive brings it back', async ({ page, browser }) => {
    await signInAsAdmin(page)
    const product = await createProductInUi(page, { price: '6.49', stock: '10' })
    await page.getByTestId('admin-archive-toggle').click()
    await expect(page.getByTestId('admin-notice')).toHaveText('Archived: hidden from the store.')

    const shopper = await (await browser.newContext()).newPage()
    await shopper.goto(`/p/${product.slug}`)
    await expect(shopper.getByTestId('not-found')).toBeVisible()

    await page.getByTestId('admin-archive-toggle').click()
    await expect(page.getByTestId('admin-notice')).toHaveText('Back on sale.')
    await shopper.goto(`/p/${product.slug}`)
    await expect(shopper.getByTestId('detail-name')).toHaveText(product.name)
    await shopper.context().close()
  })

  test('duplicate SKU is refused on the SKU field', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/products/new')
    await page.getByTestId('admin-product-sku').fill('KIT-001')
    await page.getByTestId('admin-product-name').fill(`Dup ${tag()}`)
    await page.getByTestId('admin-product-price').fill('1.00')
    await page.getByTestId('admin-product-save').click()
    await expect(page.getByTestId('admin-error-sku')).toHaveText('Already used.')
  })
})

test.describe('categories @admin', () => {
  test('create, rename (slug stays), delete; non-empty cannot be deleted', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/categories')
    const name = `Garden ${tag()}`
    await page.getByTestId('admin-category-name').fill(name)
    await page.getByTestId('admin-category-create').click()
    const created = page.getByTestId('admin-category-row').filter({ hasText: name })
    await expect(created).toBeVisible()
    const slug = await created.getAttribute('data-slug')
    // Target the row by its stable slug: once Rename turns the name into an input, the row
    // has no text matching the name (input values aren't text) and a hasText locator is lost.
    const row = page.locator(`[data-slug="${slug}"]`)

    await row.getByTestId('admin-category-edit').click()
    await row.getByTestId('admin-category-rename').fill(`${name} & Patio`)
    await row.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator(`[data-slug="${slug}"]`)).toContainText(`${name} & Patio`)

    await expect(page.locator('[data-slug="kitchen"]').getByTestId('admin-category-delete')).toBeDisabled()
    await page.locator(`[data-slug="${slug}"]`).getByTestId('admin-category-delete').click()
    await expect(page.locator(`[data-slug="${slug}"]`)).toHaveCount(0)
  })
})
