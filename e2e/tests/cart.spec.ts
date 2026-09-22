import { addFromProductPage } from '../pages/CartPage'
import { expect, test } from '../fixtures'

const GUEST_KEY = 'hb_guest_cart_v1'

test.describe('guest cart (CRT-01, CRT-02) @cart', () => {
  test('add as a guest, see it in the cart, survive a reload @smoke @mobile', async ({ page, cartPage }) => {
    await addFromProductPage(page, 'nonstick-frying-pan-10in', 2)
    await expect(page.getByTestId('add-to-cart-success')).toHaveText(/Added 2 to your cart/)
    await expect(cartPage.cartCount).toHaveText('2')

    await cartPage.goto()
    await expect(cartPage.lines).toHaveCount(1)
    await expect(cartPage.line('KIT-001').getByTestId('line-total')).toHaveText('$49.98')

    await page.reload()
    await expect(cartPage.line('KIT-001')).toBeVisible()
    await expect(cartPage.cartCount).toHaveText('2')
  })

  test('change quantity and remove', async ({ page, cartPage }) => {
    await addFromProductPage(page, 'nonstick-frying-pan-10in', 1)
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
    await cartPage.goto()

    await cartPage.setQuantity('KIT-001', 4)
    await expect(cartPage.line('KIT-001').getByTestId('line-total')).toHaveText('$99.96')
    await expect(cartPage.cartCount).toHaveText('5')

    await cartPage.remove('CLN-001')
    await expect(cartPage.lines).toHaveCount(1)
    await expect(cartPage.subtotal).toHaveText('$99.96')
  })

  test('the 11th unit is refused (max 10 per line)', async ({ page }) => {
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 10)
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
    await expect(page.getByTestId('add-to-cart-error')).toContainText('at most 10')
    await expect(page.getByTestId('in-cart')).toHaveText('10 already in your cart.')
  })

  test('stock limits the line too (only 1 glass cleaner left)', async ({ page }) => {
    await addFromProductPage(page, 'glass-cleaner-26oz', 1)
    await expect(page.getByTestId('add-to-cart-success')).toBeVisible()
    await page.getByTestId('add-to-cart').click()
    await expect(page.getByTestId('add-to-cart-error')).toContainText('at most 1')
  })

  test('free-shipping message at the $50 boundary (CHK-03)', async ({ page, cartPage }) => {
    await addFromProductPage(page, 'chef-s-knife-8in', 1) // $49.99
    await cartPage.goto()
    await expect(cartPage.freeShipping).toHaveText('Add $0.01 more for free standard shipping.')

    await addFromProductPage(page, 'cotton-swabs-500-ct', 1) // + $3.49
    await cartPage.goto()
    await expect(cartPage.freeShipping).toHaveText('Your order qualifies for free standard shipping.')
  })

  test('a second tab sees guest cart changes without reloading', async ({ page, context }) => {
    const other = await context.newPage()
    await other.goto('/')
    await expect(other.getByTestId('cart-count')).toHaveText('0')

    await addFromProductPage(page, 'nonstick-frying-pan-10in', 3)
    await expect(other.getByTestId('cart-count')).toHaveText('3') // storage event
  })

  test('tampered storage is repaired, not crashed on', async ({ page, api, cartPage }) => {
    const panId = await api.productId('nonstick-frying-pan-10in')
    await page.goto('/')
    await page.evaluate(
      ([key, id]) =>
        localStorage.setItem(
          key as string,
          JSON.stringify([{ product_id: id, quantity: 999 }, { product_id: 'x' }, 'garbage']),
        ),
      [GUEST_KEY, panId],
    )
    await cartPage.goto()
    await expect(cartPage.lines).toHaveCount(1)
    await expect(cartPage.line('KIT-001').getByTestId('line-qty')).toHaveValue('10')
  })
})

test.describe('account cart & merge (CRT-02) @cart', () => {
  test('guest items merge into the account at sign-in: summed and capped', async ({
    page,
    api,
    user,
    loginPage,
    cartPage,
  }) => {
    await api.addToAccountCart(user, 'all-purpose-cleaner-spray-32oz', 6) // saved earlier
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 6) // as guest
    await addFromProductPage(page, 'nonstick-frying-pan-10in', 2)

    await loginPage.goto('/cart')
    await loginPage.signIn(user.email, user.password)

    await expect(page).toHaveURL('/cart')
    await expect(cartPage.mergeReport).toContainText('1 item was reduced')
    await expect(cartPage.line('CLN-001').getByTestId('line-qty')).toHaveValue('10') // 6 + 6 -> 10
    await expect(cartPage.line('KIT-001').getByTestId('line-qty')).toHaveValue('2')
    await expect(cartPage.cartCount).toHaveText('12')
    expect(await page.evaluate((key) => localStorage.getItem(key), GUEST_KEY)).toBeNull()

    // Reloading must not merge again (nothing double-counted).
    await page.reload()
    await expect(cartPage.line('CLN-001').getByTestId('line-qty')).toHaveValue('10')
    await expect(cartPage.cartCount).toHaveText('12')
  })

  test('the saved cart follows the account to another browser', async ({
    page,
    browser,
    signedInUser,
    cartPage,
  }) => {
    await addFromProductPage(page, 'bamboo-cutting-board', 2)
    await expect(cartPage.cartCount).toHaveText('2')

    const laptop = await browser.newContext()
    const other = await laptop.newPage()
    const login = await other.request.post('/api/v1/auth/login', {
      data: { email: signedInUser.email, password: signedInUser.password },
    })
    expect(login.ok()).toBeTruthy()
    await other.goto('/cart')
    await expect(other.locator('[data-testid="cart-line"][data-sku="KIT-005"]')).toBeVisible()
    await laptop.close()
  })

  test('signing out hides the account cart from the next visitor', async ({
    page,
    signedInUser: _,
    cartPage,
  }) => {
    await addFromProductPage(page, 'nonstick-frying-pan-10in', 1)
    await expect(cartPage.cartCount).toHaveText('1')
    await page.getByTestId('nav-logout').click()
    await expect(cartPage.cartCount).toHaveText('0')
    await cartPage.goto()
    await expect(cartPage.empty).toBeVisible()
  })
})
