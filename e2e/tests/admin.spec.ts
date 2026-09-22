/**
 * Back office access and order handling (ADM-03, ADM-04). These don't change the catalog, so
 * they run in parallel. Catalog-changing admin tests live in isolated/admin-catalog.spec.ts:
 * a new product or category would break the catalog tests' global counts (60 products,
 * 10 per category, 6 categories) running at the same time.
 */
import { addFromProductPage } from '../pages/CartPage'
import { expect, test } from '../fixtures'
import { signInAsAdmin } from '../support/admin'

test.describe('access (ADM-04) @admin', () => {
  test('customers are kept out of the back office', async ({ page, signedInUser: _ }) => {
    await page.goto('/admin')
    await expect(page.getByTestId('forbidden')).toBeVisible()
    await expect(page.getByTestId('nav-admin')).toBeHidden()
  })

  test('the admin sees the Admin link and the dashboard', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/')
    await page.getByTestId('nav-admin').click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByTestId('low-stock')).toContainText('CLN-005')
  })
})

test.describe('orders (ADM-03) @admin', () => {
  test('staff fulfil an order and the customer sees each step', async ({
    page,
    browser,
    shopper,
    checkoutPage,
    payPage,
    orderPage,
  }) => {
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
    await checkoutPage.goto()
    const number = await checkoutPage.place()
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid')

    const staff = await (await browser.newContext()).newPage()
    await signInAsAdmin(staff)
    await staff.goto(`/admin/orders?q=${encodeURIComponent(shopper.email)}`)
    await staff.locator(`[data-order="${number}"]`).getByRole('link').click()
    await expect(staff.getByTestId('admin-order-customer')).toContainText(shopper.email)

    for (const [action, label] of [
      ['processing', 'Processing'],
      ['shipped', 'Shipped'],
      ['delivered', 'Delivered'],
    ] as const) {
      await staff.getByTestId(`admin-order-action-${action}`).click()
      await expect(staff.getByTestId('order-status')).toHaveText(label)
    }
    await staff.getByTestId('admin-order-note').fill('Arrived damaged')
    await staff.getByTestId('admin-order-action-refunded').click()
    await expect(staff.getByTestId('order-status')).toHaveText('Refunded')
    await expect(staff.getByTestId('admin-order-payments')).toContainText('refunded')

    await orderPage.goto(number)
    await expect(orderPage.status).toHaveText('Refunded')
    await expect(orderPage.history).toContainText('Arrived damaged')
    await staff.context().close()
  })

  test('staff cancel a paid order: stock back, customer refunded', async ({
    page,
    api,
    browser,
    shopper: _,
    checkoutPage,
    payPage,
    orderPage,
  }) => {
    await addFromProductPage(page, 'non-scratch-scrub-sponges-6-pk', 2)
    await checkoutPage.goto()
    const number = await checkoutPage.place()
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid')

    const staff = await (await browser.newContext()).newPage()
    await signInAsAdmin(staff)
    await staff.goto(`/admin/orders/${number}`)
    await staff.getByTestId('admin-order-action-cancelled').click()
    await expect(staff.getByTestId('order-status')).toHaveText('Cancelled')
    // Other parallel tests buy sponges too, so compare this order's own ledger row, not totals.
    const movements = await api.ledger('CLN-004')
    expect(movements).toContainEqual(expect.objectContaining({ order_number: number, reason: 'order_cancelled', delta: 2 }))

    await orderPage.goto(number)
    await expect(orderPage.refund).toBeVisible()
    await staff.context().close()
  })
})
