/**
 * Cart behaviour when products change after they were added (CRT-03, CRT-04). These change
 * shared product data, so they live in the serial "isolated" project and restore it after.
 */
import { addFromProductPage } from '../../pages/CartPage'
import { expect, test } from '../../fixtures'

test.describe.configure({ mode: 'serial' })

test.afterEach(async ({ resetDb }) => {
  await resetDb() // put prices/stock back for whatever runs next
})

test('price rise is flagged, total uses today’s price, notice can be dismissed (CRT-03)', async ({
  page,
  api,
  signedInUser: _,
  cartPage,
}) => {
  await addFromProductPage(page, 'nonstick-frying-pan-10in', 2) // $24.99
  await api.changeProduct('KIT-001', { price_cents: 2799 })

  await cartPage.goto()
  await expect(cartPage.priceNotice).toBeVisible()
  await expect(cartPage.line('KIT-001').getByTestId('line-price-change')).toHaveText(
    'Price went up from $24.99 to $27.99',
  )
  await expect(cartPage.subtotal).toHaveText('$55.98')

  await cartPage.acknowledgePrices.click()
  await expect(cartPage.priceNotice).toBeHidden()
  await page.reload()
  await expect(cartPage.priceNotice).toBeHidden() // acknowledged on the server
})

test('guests are told about price drops too', async ({ page, api, cartPage }) => {
  await addFromProductPage(page, 'nonstick-frying-pan-10in', 1)
  await api.changeProduct('KIT-001', { price_cents: 1999 })
  await cartPage.goto()
  await expect(cartPage.line('KIT-001').getByTestId('line-price-change')).toHaveText(
    'Price dropped from $24.99 to $19.99',
  )
})

test('stock drop after adding flags the line and blocks checkout (CRT-04)', async ({
  page,
  api,
  signedInUser: _,
  cartPage,
}) => {
  await addFromProductPage(page, 'nonstick-frying-pan-10in', 4)
  await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
  await api.changeProduct('KIT-001', { stock_qty: 2 })

  await cartPage.goto()
  await expect(cartPage.line('KIT-001')).toHaveAttribute('data-issue', 'insufficient_stock')
  await expect(cartPage.line('KIT-001').getByTestId('line-issue')).toHaveText(
    'Only 2 available - lower the quantity.',
  )
  await expect(cartPage.subtotal).toHaveText('$4.99')
  await expect(cartPage.hasIssues).toBeVisible()
  await expect(cartPage.checkout).toBeDisabled()

  await cartPage.setQuantity('KIT-001', 2)
  await expect(cartPage.line('KIT-001')).toHaveAttribute('data-issue', '')
  await expect(cartPage.hasIssues).toBeHidden()
})

test('archived product can only be removed', async ({ page, api, signedInUser: _, cartPage }) => {
  await addFromProductPage(page, 'nonstick-frying-pan-10in', 1)
  await api.changeProduct('KIT-001', { is_archived: true })

  await cartPage.goto()
  await expect(cartPage.line('KIT-001').getByTestId('line-issue')).toHaveText(
    'No longer sold - please remove it.',
  )
  await expect(cartPage.line('KIT-001').getByTestId('line-qty')).toBeDisabled()
  await cartPage.remove('KIT-001')
  await expect(cartPage.empty).toBeVisible()
})
