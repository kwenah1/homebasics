/**
 * Checkout journeys. Placing orders takes shared stock, so these parallel tests only buy
 * well-stocked items (the 150-unit spray, 120 sponges); last-unit races live in isolated/.
 */
import { addFromProductPage } from '../pages/CartPage'
import { expect, test } from '../fixtures'

const SPRAY = 'all-purpose-cleaner-spray-32oz' // $4.99, stock 150
const SPONGES = 'non-scratch-scrub-sponges-6-pk' // $5.99, stock 120

test.describe('checkout & pay (CHK-01..08) @checkout', () => {
  test('buy two sprays: Texas tax, shipping, pay, confirmation @smoke @mobile', async ({
    page,
    shopper: _,
    checkoutPage,
    payPage,
    orderPage,
  }) => {
    await addFromProductPage(page, SPRAY, 2)
    await page.goto('/cart')
    await page.getByTestId('checkout').click()

    await expect(checkoutPage.subtotal).toHaveText('$9.98')
    await expect(checkoutPage.tax).toHaveText('$0.82') // 998 x 8.25% = 82.335 -> 82
    await expect(checkoutPage.shipping).toHaveText('$5.99')
    await expect(checkoutPage.total).toHaveText('$16.79')

    const orderNumber = await checkoutPage.place()
    await expect(payPage.total).toHaveText('Total: $16.79')
    await expect(payPage.countdown).toContainText(/Time left to pay: (29|30):\d\d/)
    await expect(page.getByTestId('cart-count')).toHaveText('0') // cart emptied on placement

    await payPage.payWithTestCard('4242')
    await expect(orderPage.thanks).toContainText(`${orderNumber} is confirmed`)
    await expect(orderPage.status).toHaveText('Paid')
    await expect(orderPage.history).toContainText('Paid with card ••4242')

    await page.getByTestId('nav-orders').click()
    await expect(page.locator(`[data-order="${orderNumber}"]`)).toContainText('Paid')
  })

  test('declined card, then insufficient funds, then success', async ({ page, shopper: _, checkoutPage, payPage, orderPage }) => {
    await addFromProductPage(page, SPONGES, 1)
    await checkoutPage.goto()
    await checkoutPage.place()

    await payPage.payWithTestCard('0002')
    await expect(payPage.error).toHaveText('Your card was declined.')
    await payPage.payWithTestCard('9995')
    await expect(payPage.error).toHaveText('Your card has insufficient funds.')
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid')
  })

  test('express shipping is charged even over $50', async ({ page, shopper: _, checkoutPage }) => {
    await addFromProductPage(page, SPRAY, 10) // $49.90
    await addFromProductPage(page, SPONGES, 1) // + $5.99 = $55.89
    await checkoutPage.goto()
    await expect(checkoutPage.shipping).toHaveText('Free')
    await checkoutPage.chooseShipping('express')
    await expect(checkoutPage.shipping).toHaveText('$14.99')
  })

  test('shipping is $5.99 at $49.90 and free once over $50', async ({ page, shopper: _, checkoutPage }) => {
    await addFromProductPage(page, SPRAY, 10) // $49.90
    await checkoutPage.goto()
    await expect(checkoutPage.shipping).toHaveText('$5.99')
    await addFromProductPage(page, 'cotton-swabs-500-ct', 1) // + $3.49
    await checkoutPage.goto()
    await expect(checkoutPage.shipping).toHaveText('Free')
  })

  test('shipping to Oregon: no sales tax', async ({ page, api, signedInUser, checkoutPage }) => {
    await api.addAddress(signedInUser, { state: 'OR', city: 'Portland', postal_code: '97201' })
    await addFromProductPage(page, SPRAY, 2)
    await checkoutPage.goto()
    await expect(page.getByText('Tax (OR 0%)')).toBeVisible()
    await expect(checkoutPage.tax).toHaveText('$0.00')
  })

  test('cancel a paid order: refunded and stock returned', async ({ page, request, shopper: _, checkoutPage, payPage, orderPage }) => {
    const before = (await (await request.get('/api/v1/products/' + SPONGES)).json()).stock_status
    await addFromProductPage(page, SPONGES, 3)
    await checkoutPage.goto()
    await checkoutPage.place()
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid')

    await orderPage.cancel.click()
    await orderPage.confirmCancel.click()
    await expect(orderPage.status).toHaveText('Cancelled')
    await expect(orderPage.refund).toHaveText(/Refunded \$\d+\.\d\d to card ending 4242\./)
    await expect(orderPage.history).toContainText('payment refunded')
    expect((await (await request.get('/api/v1/products/' + SPONGES)).json()).stock_status).toBe(before)
  })

  test('shipped orders can no longer be cancelled', async ({ page, api, shopper: _, checkoutPage, payPage, orderPage }) => {
    await addFromProductPage(page, SPRAY, 1)
    await checkoutPage.goto()
    const number = await checkoutPage.place()
    await payPage.payWithTestCard('4242')
    await expect(orderPage.status).toHaveText('Paid') // wait: the click alone doesn't mean it's paid
    await api.setOrderStatus(number, 'processing')
    await orderPage.goto(number)
    await expect(orderPage.cancel).toBeVisible()

    await api.setOrderStatus(number, 'shipped')
    await orderPage.goto(number)
    await expect(orderPage.status).toHaveText('Shipped')
    await expect(orderPage.cancel).toBeHidden()
  })

  test('guest checks out: sign in, cart merges, straight back to checkout', async ({
    page,
    api,
    user,
    loginPage,
    checkoutPage,
  }) => {
    await api.addAddress(user)
    await addFromProductPage(page, SPRAY, 2)
    await page.goto('/cart')
    await expect(page.getByTestId('checkout')).toHaveText('Sign in to check out')
    await page.getByTestId('checkout').click()

    await loginPage.signIn(user.email, user.password)
    await expect(page).toHaveURL('/checkout')
    await expect(checkoutPage.subtotal).toHaveText('$9.98')
  })

  test("another customer's order is not found", async ({ page, api, shopper, checkoutPage, browser }) => {
    await addFromProductPage(page, SPRAY, 1)
    await checkoutPage.goto()
    const number = await checkoutPage.place()

    const stranger = await browser.newContext()
    const strangerPage = await stranger.newPage()
    const other = { ...shopper, email: `x.${Date.now()}@e2e.test` }
    await api.register(other)
    await strangerPage.request.post('/api/v1/auth/login', { data: { email: other.email, password: other.password } })
    await strangerPage.goto(`/orders/${number}`)
    await expect(strangerPage.getByTestId('not-found')).toBeVisible()
    await stranger.close()
  })
})
