import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { TEXAS_HOME } from '../pages/AccountPage'
import { expect, test } from '../fixtures'

const PUBLIC_PAGES = [
  { name: 'home', path: '/' },
  { name: 'category', path: '/c/kitchen' },
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
