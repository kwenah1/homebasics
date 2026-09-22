import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { TEXAS_HOME } from '../pages/AccountPage'
import { addFromProductPage } from '../pages/CartPage'
import { expect, test } from '../fixtures'

const PUBLIC_PAGES = [
  { name: 'home', path: '/' },
  { name: 'category', path: '/c/kitchen' },
  { name: 'search results with filters', path: '/products?q=towel&max=50&in_stock=1' },
  { name: 'empty results', path: '/products?q=lawnmower' },
  { name: 'product detail (low stock)', path: '/p/glass-cleaner-26oz' },
  { name: 'product detail (out of stock)', path: '/p/dish-drying-rack' },
  { name: 'empty cart', path: '/cart' },
  { name: '404', path: '/missing' },
  { name: 'sign in', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'forgot password', path: '/forgot-password' },
  { name: 'reset password (dead link)', path: '/reset-password' },
]

async function expectNoViolations(page: Page) {
  await expect(page.getByTestId('api-status')).not.toHaveAttribute('data-state', 'checking')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([])
}

test.describe('accessibility (WCAG 2.1 AA) @a11y', () => {
  for (const { name, path } of PUBLIC_PAGES) {
    test(`${name} page has no axe violations`, async ({ page }) => {
      await page.goto(path)
      await expectNoViolations(page)
    })
  }

  test('form with validation errors has no axe violations', async ({ registerPage, page }) => {
    await registerPage.goto()
    await registerPage.submit.click()
    await expect(registerPage.fieldError('email')).toBeVisible()
    await expectNoViolations(page)
  })

  test('cart page with items has no axe violations', async ({ page, cartPage }) => {
    await addFromProductPage(page, 'nonstick-frying-pan-10in', 2)
    await addFromProductPage(page, 'glass-cleaner-26oz', 1)
    await cartPage.goto()
    await expect(cartPage.lines).toHaveCount(2)
    await expectNoViolations(page)
  })

  test('checkout, pay and order pages have no axe violations', async ({ page, shopper: _ }) => {
    await addFromProductPage(page, 'all-purpose-cleaner-spray-32oz', 1)
    await page.goto('/checkout')
    await expect(page.getByTestId('summary-total')).toBeVisible()
    await expectNoViolations(page)

    await page.getByTestId('place-order').click()
    await expect(page.getByTestId('pay-submit')).toBeVisible()
    await expectNoViolations(page)

    await page.getByTestId('use-card-4242').click()
    await page.getByTestId('pay-submit').click()
    await expect(page.getByTestId('order-status')).toHaveText('Paid')
    await expectNoViolations(page)
  })

  test('account page with addresses has no axe violations', async ({
    accountPage,
    signedInUser: _,
    page,
  }) => {
    await accountPage.goto()
    await accountPage.addAddress(TEXAS_HOME)
    await accountPage.addButton.click() // open the form too
    await expectNoViolations(page)
  })
})
