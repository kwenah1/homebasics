import type { Locator, Page } from '@playwright/test'

import { BasePage } from './BasePage'

export class CartPage extends BasePage {
  readonly lines: Locator
  readonly empty: Locator
  readonly subtotal: Locator
  readonly itemCount: Locator
  readonly freeShipping: Locator
  readonly priceNotice: Locator
  readonly acknowledgePrices: Locator
  readonly mergeReport: Locator
  readonly checkout: Locator
  readonly hasIssues: Locator

  constructor(page: Page) {
    super(page)
    this.lines = page.getByTestId('cart-line')
    this.empty = page.getByTestId('cart-empty')
    this.subtotal = page.getByTestId('cart-subtotal')
    this.itemCount = page.getByTestId('cart-item-count')
    this.freeShipping = page.getByTestId('free-shipping')
    this.priceNotice = page.getByTestId('price-change-notice')
    this.acknowledgePrices = page.getByTestId('acknowledge-prices')
    this.mergeReport = page.getByTestId('merge-report')
    this.checkout = page.getByTestId('checkout')
    this.hasIssues = page.getByTestId('cart-has-issues')
  }

  async goto() {
    await this.page.goto('/cart')
    await this.page.getByTestId('cart-loading').waitFor({ state: 'detached' })
  }

  line(sku: string): Locator {
    return this.page.locator(`[data-testid="cart-line"][data-sku="${sku}"]`)
  }

  async setQuantity(sku: string, quantity: number) {
    await this.line(sku).getByTestId('line-qty').selectOption(String(quantity))
  }

  async remove(sku: string) {
    await this.line(sku).getByTestId('line-remove').click()
    await this.line(sku).waitFor({ state: 'detached' })
  }
}

/** Add from a product page: pick a quantity, click Add, wait for the outcome message. */
export async function addFromProductPage(page: Page, slug: string, quantity = 1) {
  await page.goto(`/p/${slug}`)
  await page.getByTestId('detail-qty').selectOption(String(quantity))
  await page.getByTestId('add-to-cart').click()
  await page.locator('[data-testid="add-to-cart-success"], [data-testid="add-to-cart-error"]').waitFor()
}
