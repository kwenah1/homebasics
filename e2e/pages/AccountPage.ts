import type { Locator, Page } from '@playwright/test'

import { BasePage } from './BasePage'

export interface AddressData {
  label: string
  recipient: string
  line1: string
  line2?: string
  city: string
  state: string // two-letter code, e.g. "TX"
  postal: string
  makeDefault?: boolean
}

export const TEXAS_HOME: AddressData = {
  label: 'Home',
  recipient: 'Pat Tester',
  line1: '100 Congress Ave',
  city: 'Austin',
  state: 'TX',
  postal: '78701',
}

export class AccountPage extends BasePage {
  readonly heading: Locator
  readonly addressCards: Locator
  readonly addButton: Locator
  readonly addressCount: Locator
  readonly addressForm: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByTestId('account-heading')
    this.addressCards = page.getByTestId('address-card')
    this.addButton = page.getByTestId('address-add')
    this.addressCount = page.getByTestId('address-count')
    this.addressForm = page.getByTestId('address-form')
  }

  async goto() {
    await this.page.goto('/account')
  }

  card(label: string): Locator {
    return this.addressCards.filter({ hasText: label })
  }

  async addAddress(address: AddressData) {
    await this.addButton.click()
    await this.fillAddress(address)
    await this.page.getByTestId('address-submit').click()
    await this.addressForm.waitFor({ state: 'detached' })
  }

  async fillAddress(a: Partial<AddressData>) {
    const form = this.addressForm
    if (a.label !== undefined) await form.getByTestId('address-label').fill(a.label)
    if (a.recipient !== undefined) await form.getByTestId('address-recipient').fill(a.recipient)
    if (a.line1 !== undefined) await form.getByTestId('address-line1').fill(a.line1)
    if (a.line2 !== undefined) await form.getByTestId('address-line2').fill(a.line2)
    if (a.city !== undefined) await form.getByTestId('address-city').fill(a.city)
    if (a.state !== undefined) await form.getByTestId('address-state').selectOption(a.state)
    if (a.postal !== undefined) await form.getByTestId('address-postal').fill(a.postal)
    if (a.makeDefault) await form.getByTestId('address-default').check()
  }

  async updateProfile(first: string, last: string) {
    await this.page.getByTestId('profile-first-name').fill(first)
    await this.page.getByTestId('profile-last-name').fill(last)
    await this.page.getByTestId('profile-submit').click()
  }

  async changePassword(current: string, next: string) {
    await this.page.getByTestId('password-current').fill(current)
    await this.page.getByTestId('password-new').fill(next)
    await this.page.getByTestId('password-confirm').fill(next)
    await this.page.getByTestId('password-submit').click()
  }
}
