import type { Locator, Page } from '@playwright/test'

import { BasePage } from './BasePage'

export class CheckoutPage extends BasePage {
  readonly subtotal: Locator
  readonly tax: Locator
  readonly shipping: Locator
  readonly total: Locator
  readonly placeOrder: Locator
  readonly error: Locator
  readonly blocked: Locator

  constructor(page: Page) {
    super(page)
    this.subtotal = page.getByTestId('summary-subtotal')
    this.tax = page.getByTestId('summary-tax')
    this.shipping = page.getByTestId('summary-shipping')
    this.total = page.getByTestId('summary-total')
    this.placeOrder = page.getByTestId('place-order')
    this.error = page.getByTestId('checkout-error')
    this.blocked = page.getByTestId('checkout-blocked')
  }

  async goto() {
    await this.page.goto('/checkout')
    await this.total.waitFor()
  }

  async chooseShipping(method: 'standard' | 'express') {
    const response = this.page.waitForResponse('**/api/v1/checkout/quote')
    await this.page.getByTestId(`shipping-${method}`).check()
    await response
  }

  /** Place the order and return its number once the pay page has loaded. */
  async place(): Promise<string> {
    await this.placeOrder.click()
    await this.page.waitForURL(/\/orders\/HB-[A-Z0-9]{8}\/pay$/)
    return this.page.url().match(/HB-[A-Z0-9]{8}/)![0]
  }
}

export class PayPage extends BasePage {
  readonly total: Locator
  readonly countdown: Locator
  readonly error: Locator
  readonly expired: Locator
  readonly submit: Locator

  constructor(page: Page) {
    super(page)
    this.total = page.getByTestId('pay-total')
    this.countdown = page.getByTestId('pay-countdown')
    this.error = page.getByTestId('pay-error')
    this.expired = page.getByTestId('pay-expired')
    this.submit = page.getByTestId('pay-submit')
  }

  /** One of the published test cards: 4242 (ok), 0002 (declined), 9995 (insufficient funds). */
  async payWithTestCard(last4: '4242' | '0002' | '9995') {
    await this.page.getByTestId(`use-card-${last4}`).click()
    await this.submit.click()
  }
}

export class OrderPage extends BasePage {
  readonly status: Locator
  readonly thanks: Locator
  readonly total: Locator
  readonly cancel: Locator
  readonly confirmCancel: Locator
  readonly refund: Locator
  readonly history: Locator
  readonly payNow: Locator

  constructor(page: Page) {
    super(page)
    this.status = page.getByTestId('order-status')
    this.thanks = page.getByTestId('order-thanks')
    this.total = page.getByTestId('order-total')
    this.cancel = page.getByTestId('order-cancel')
    this.confirmCancel = page.getByTestId('order-cancel-confirm')
    this.refund = page.getByTestId('order-refund')
    this.history = page.getByTestId('order-history')
    this.payNow = page.getByTestId('order-pay')
  }

  async goto(orderNumber: string) {
    await this.page.goto(`/orders/${orderNumber}`)
    await this.status.waitFor()
  }
}
