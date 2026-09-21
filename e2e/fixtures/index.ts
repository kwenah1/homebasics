import { test as base, expect } from '@playwright/test'

import { AccountPage } from '../pages/AccountPage'
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '../pages/AuthPages'
import { CartPage } from '../pages/CartPage'
import { ProductDetailPage, ProductListPage } from '../pages/CatalogPages'
import { HomePage } from '../pages/HomePage'
import { API_URL, Api, uniqueUser } from '../support/api'
import type { TestUser } from '../support/api'

type Fixtures = {
  api: Api
  homePage: HomePage
  loginPage: LoginPage
  registerPage: RegisterPage
  forgotPage: ForgotPasswordPage
  resetPage: ResetPasswordPage
  accountPage: AccountPage
  listPage: ProductListPage
  detailPage: ProductDetailPage
  cartPage: CartPage
  /** A brand-new registered customer (not signed in in the browser). */
  user: TestUser
  /** Same as `user`, but the browser already holds its session cookie. */
  signedInUser: TestUser
  /** Call to put the database back to the deterministic seed state. */
  resetDb: () => Promise<void>
}

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => use(new Api(request)),
  homePage: async ({ page }, use) => use(new HomePage(page)),
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  registerPage: async ({ page }, use) => use(new RegisterPage(page)),
  forgotPage: async ({ page }, use) => use(new ForgotPasswordPage(page)),
  resetPage: async ({ page }, use) => use(new ResetPasswordPage(page)),
  accountPage: async ({ page }, use) => use(new AccountPage(page)),
  listPage: async ({ page }, use) => use(new ProductListPage(page)),
  detailPage: async ({ page }, use) => use(new ProductDetailPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),

  user: async ({ api }, use) => {
    const user = uniqueUser()
    await api.register(user)
    await use(user)
  },

  signedInUser: async ({ user, page }, use) => {
    // Sign in through the web origin (Vite proxy) so the httpOnly refresh cookie lands in
    // this browser context - no UI clicks, so these tests stay fast and focused.
    const response = await page.request.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    await use(user)
  },

  resetDb: async ({ request }, use) => {
    await use(async () => {
      const response = await request.post(`${API_URL}/api/v1/test/reset`)
      expect(response.ok(), 'test reset endpoint must be enabled').toBeTruthy()
    })
  },
})

export { expect }
