/**
 * Visual regression (M10). Everything else we test asserts behaviour; nothing notices when a
 * CSS change quietly breaks a layout. These compare full pages against committed baselines.
 *
 * Baselines are rendered on Linux by CI (`.github/workflows/visual-baselines.yml`), because
 * fonts and form controls differ per platform - a Windows or macOS screenshot would never
 * match CI. They run in their own project so a diff never blocks the behavioural suite.
 *
 * Pages are made deterministic first: the seeded catalog is fixed, but dates, countdowns and
 * the "only N left" counts move, so anything time- or stock-dependent is masked.
 */
import { expect, test } from '../../fixtures'
import { addFromProductPage } from '../../pages/CartPage'

const SPRAY = 'all-purpose-cleaner-spray-32oz'

// Full-page shots catch layout shifts; a little tolerance absorbs font antialiasing.
const shot = { fullPage: true, maxDiffPixelRatio: 0.01, animations: 'disabled' as const }

test.describe('visual regression @visual', () => {
  test('home page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('api-status')).not.toHaveAttribute('data-state', 'checking')
    await expect(page).toHaveScreenshot('home.png', shot)
  })

  test('category listing', async ({ page }) => {
    await page.goto('/c/kitchen')
    await expect(page.getByTestId('product-card').first()).toBeVisible()
    await expect(page).toHaveScreenshot('category.png', {
      ...shot,
      // Stock badges change as other tests buy things.
      mask: [page.locator('[data-testid="stock-badge"]')],
    })
  })

  test('product detail with reviews', async ({ page }) => {
    await page.goto(`/p/${SPRAY}`)
    await expect(page.getByTestId('reviews')).toBeVisible()
    await expect(page).toHaveScreenshot('product.png', {
      ...shot,
      mask: [page.locator('[data-testid="stock-badge"]'), page.locator('[data-testid="reviews"]')],
    })
  })

  test('cart with an item', async ({ page }) => {
    await addFromProductPage(page, SPRAY, 2)
    await page.goto('/cart')
    await expect(page.getByTestId('cart-line')).toHaveCount(1)
    await expect(page).toHaveScreenshot('cart.png', shot)
  })

  test('sign-in form, empty and refused', async ({ page, loginPage }) => {
    await loginPage.goto()
    await expect(page).toHaveScreenshot('login.png', shot)
    await loginPage.signIn('nobody@e2e.test', 'Wrongpass123')
    await expect(loginPage.error).toBeVisible()
    await expect(page).toHaveScreenshot('login-errors.png', shot)
  })

  test('404 page', async ({ page }) => {
    await page.goto('/no-such-page')
    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page).toHaveScreenshot('404.png', shot)
  })
})
