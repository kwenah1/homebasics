/**
 * Phase 2 journeys (M8): coupons, wishlist and returns. Parallel-safe: fresh shoppers, codes
 * made unique per test, and only the well-stocked spray / sponges are bought. Reviews change a
 * product's public rating (which the catalog tests sort by), so they live in isolated/.
 */
import type { Browser, Page } from '@playwright/test'

import { addFromProductPage } from '../pages/CartPage'
import { expect, test } from '../fixtures'
import { signInAsAdmin, tag } from '../support/admin'

const SPRAY = 'all-purpose-cleaner-spray-32oz' // $4.99, stock 150
const SPONGES = 'non-scratch-scrub-sponges-6-pk' // $5.99, stock 120

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await signInAsAdmin(page)
  return page
}

async function applyCoupon(page: Page, code: string) {
  const quoted = page.waitForResponse('**/api/v1/checkout/quote')
  await page.getByTestId('coupon-input').fill(code)
  await page.getByTestId('coupon-apply').click()
  await quoted
}

test.describe('coupons at checkout (CPN) @checkout', () => {
  test('WELCOME10 takes 10% off once per customer @mobile', async ({ page, shopper: _, checkoutPage, payPage, orderPage }) => {
    await addFromProductPage(page, SPRAY, 2) // $9.98
    await checkoutPage.goto()
    await applyCoupon(page, 'welcome10')
    await expect(page.getByTestId('coupon-applied')).toContainText('WELCOME10')
    await expect(page.getByTestId('summary-discount')).toHaveText('−$1.00') // 99.8 -> 100
    await expect(checkoutPage.tax).toHaveText('$0.74') // 8.25% of $8.98 = 74.085 -> 74
    await expect(checkoutPage.total).toHaveText('$15.71') // 898 + 74 + 599

    await checkoutPage.place()
    await expect(payPage.total).toHaveText('Total: $15.71')
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid')
    await expect(page.getByTestId('order-discount')).toHaveText('−$1.00')

    await addFromProductPage(page, SPRAY, 1)
    await checkoutPage.goto()
    await applyCoupon(page, 'WELCOME10')
    await expect(page.getByTestId('coupon-error')).toHaveText("You've already used that code.")
  })

  test('an unknown or expired code is explained and nothing changes', async ({ page, shopper: _, checkoutPage }) => {
    await addFromProductPage(page, SPONGES, 1)
    await checkoutPage.goto()
    const before = await checkoutPage.total.textContent()
    await applyCoupon(page, 'NOSUCHCODE')
    await expect(page.getByTestId('coupon-error')).toHaveText("That code isn't valid.")
    await applyCoupon(page, 'SPRING25')
    await expect(page.getByTestId('coupon-error')).toHaveText('That code has expired.')
    await expect(checkoutPage.total).toHaveText(before!)
  })

  test('staff create a coupon in the back office and a shopper uses it', async ({ browser, page, shopper: _, checkoutPage }) => {
    const code = `E2E${tag()}`.slice(0, 20)
    const admin = await adminPage(browser)
    await admin.goto('/admin/coupons')
    await admin.getByTestId('coupon-code').fill(code)
    await admin.getByTestId('coupon-description').fill('Two dollars off')
    await admin.getByTestId('coupon-kind-fixed').check()
    await admin.getByTestId('coupon-amount').fill('2')
    await admin.getByTestId('coupon-create').click()
    await expect(admin.getByTestId('admin-notice')).toHaveText(`Created ${code}.`)
    await expect(admin.locator(`[data-code="${code}"]`)).toContainText('$2.00 off')

    await addFromProductPage(page, SPONGES, 1) // $5.99
    await checkoutPage.goto()
    await applyCoupon(page, code.toLowerCase())
    await expect(page.getByTestId('summary-discount')).toHaveText('−$2.00')
    await checkoutPage.place()

    await admin.reload()
    await expect(admin.locator(`[data-code="${code}"]`).getByTestId('coupon-uses')).toHaveText('1')
    await admin.context().close()
  })
})

test.describe('wishlist (WSH)', () => {
  test('save from the product page, then move it to the cart', async ({ page, shopper: _ }) => {
    await page.goto(`/p/${SPONGES}`)
    const toggle = page.getByTestId('wishlist-toggle')
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('nav-wishlist').click()
    const item = page.getByTestId('wishlist-item')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('Non-Scratch Scrub Sponges')
    await item.getByTestId('wishlist-move').click()
    await expect(page.getByTestId('wishlist-message')).toContainText('Moved')
    await expect(page.getByTestId('wishlist-empty')).toBeVisible()
    await expect(page.getByTestId('cart-count')).toHaveText('1')
  })

  test('signed-out Save asks you to sign in first', async ({ page }) => {
    await page.goto(`/p/${SPONGES}`)
    await page.getByTestId('wishlist-toggle').click()
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fp%2F${SPONGES}`))
  })
})

test.describe('returns (RET)', () => {
  test('request a return, staff approve and receive it, the refund is shown', async ({
    browser,
    page,
    api,
    shopper,
    orderPage,
  }) => {
    // 2 sponges: $11.98 + 8.25% tax ($0.99) + $5.99 shipping. Goods paid: $12.97.
    const orderNumber = await api.buyAndDeliver(shopper, SPONGES, 2)
    await orderPage.goto(orderNumber)
    await expect(page.getByTestId('return-by')).toContainText('You can return items until')
    await page.getByTestId('return-start').click()
    await page.getByTestId('return-qty-CLN-004').selectOption('1')
    await page.getByTestId('return-reason').selectOption('damaged')
    await page.getByTestId('return-note').fill('Torn packaging')
    await page.getByTestId('return-submit').click()
    const row = page.getByTestId('return-row')
    await expect(row).toContainText('Requested')
    const returnNumber = await row.getAttribute('data-return')

    const admin = await adminPage(browser)
    await admin.goto('/admin/returns')
    const card = admin.locator(`[data-return="${returnNumber}"]`)
    await expect(card).toContainText('“Torn packaging”')
    await card.getByTestId('return-approve').click()
    await expect(admin.getByTestId('admin-returns-done')).toHaveText(`${returnNumber}: Approved.`)
    await expect(card).toBeHidden() // decided: it left the "requested" queue
    await admin.getByTestId('returns-filter').selectOption('approved')
    await expect(card.getByTestId('return-restock')).not.toBeChecked() // damaged: not resold
    await card.getByTestId('return-receive').click()
    // One of two sponges: floor(1297 x 599 / 1198) = 648
    await expect(admin.getByTestId('admin-returns-done')).toHaveText(`${returnNumber}: Received - refunded $6.48.`)
    await admin.context().close()

    await page.reload()
    await expect(row).toContainText('Received - refunded')
    await expect(row.getByTestId('return-refund')).toHaveText('Refunded $6.48')
    await expect(page.getByTestId('order-refund')).toHaveText('Refunded $6.48 to card ending 4242.')

    const subjects = (await api.emailsTo(shopper.email)).map((e) => e.subject)
    expect(subjects).toEqual(
      expect.arrayContaining([
        `Return ${returnNumber}: requested`,
        `Return ${returnNumber}: approved`,
        `Return ${returnNumber}: received`,
        `Your order ${orderNumber} was delivered`,
      ]),
    )
  })

  test('a customer can cancel a return they no longer need', async ({ page, api, shopper, orderPage }) => {
    const orderNumber = await api.buyAndDeliver(shopper, SPRAY, 1)
    await orderPage.goto(orderNumber)
    await page.getByTestId('return-start').click()
    await page.getByTestId('return-qty-CLN-001').selectOption('1')
    await page.getByTestId('return-reason').selectOption('no_longer_needed')
    await page.getByTestId('return-submit').click()
    await expect(page.getByTestId('return-start')).toBeHidden() // nothing left to return
    await page.getByTestId('return-cancel').click()
    await expect(page.getByTestId('return-row')).toContainText('Cancelled')
    await expect(page.getByTestId('return-start')).toBeVisible() // units are returnable again
  })
})
