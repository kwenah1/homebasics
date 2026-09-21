import type { Locator, Page } from '@playwright/test'

/** Header + footer shared by every storefront page. */
export class BasePage {
  readonly page: Page
  readonly logo: Locator
  readonly signInLink: Locator
  readonly cartLink: Locator
  readonly cartCount: Locator
  readonly apiStatus: Locator

  constructor(page: Page) {
    this.page = page
    this.logo = page.getByTestId('nav-home')
    this.signInLink = page.getByTestId('nav-login')
    this.cartLink = page.getByTestId('nav-cart')
    this.cartCount = page.getByTestId('cart-count')
    this.apiStatus = page.getByTestId('api-status')
  }

  categoryNav(slug: string): Locator {
    return this.page.getByTestId(`nav-category-${slug}`)
  }
}
