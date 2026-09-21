import type { Locator, Page } from '@playwright/test'

import type { TestUser } from '../support/api'
import { BasePage } from './BasePage'

export class LoginPage extends BasePage {
  readonly email: Locator
  readonly password: Locator
  readonly submit: Locator
  readonly error: Locator
  readonly forgotLink: Locator
  readonly resetSuccess: Locator

  constructor(page: Page) {
    super(page)
    this.email = page.getByTestId('login-email')
    this.password = page.getByTestId('login-password')
    this.submit = page.getByTestId('login-submit')
    this.error = page.getByTestId('login-error')
    this.forgotLink = page.getByTestId('link-forgot')
    this.resetSuccess = page.getByTestId('reset-success')
  }

  async goto(next?: string) {
    await this.page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  }

  async signIn(email: string, password: string) {
    await this.email.fill(email)
    await this.password.fill(password)
    await this.submit.click()
  }
}

export class RegisterPage extends BasePage {
  readonly submit: Locator
  readonly error: Locator

  constructor(page: Page) {
    super(page)
    this.submit = page.getByTestId('register-submit')
    this.error = page.getByTestId('register-error')
  }

  field(name: 'first-name' | 'last-name' | 'email' | 'password' | 'confirm-password') {
    return this.page.getByTestId(`register-${name}`)
  }

  fieldError(name: 'first-name' | 'last-name' | 'email' | 'password' | 'confirm-password') {
    return this.page.getByTestId(`register-${name}-error`)
  }

  async goto() {
    await this.page.goto('/register')
  }

  async registerAs(user: TestUser, confirm = user.password) {
    await this.field('first-name').fill(user.firstName)
    await this.field('last-name').fill(user.lastName)
    await this.field('email').fill(user.email)
    await this.field('password').fill(user.password)
    await this.field('confirm-password').fill(confirm)
    await this.submit.click()
  }
}

export class ForgotPasswordPage extends BasePage {
  async goto() {
    await this.page.goto('/forgot-password')
  }

  async request(email: string) {
    await this.page.getByTestId('forgot-email').fill(email)
    await this.page.getByTestId('forgot-submit').click()
  }

  get confirmation() {
    return this.page.getByTestId('forgot-sent')
  }
}

export class ResetPasswordPage extends BasePage {
  readonly invalid: Locator

  constructor(page: Page) {
    super(page)
    this.invalid = page.getByTestId('reset-invalid')
  }

  async choose(password: string) {
    await this.page.getByTestId('reset-password').fill(password)
    await this.page.getByTestId('reset-confirm-password').fill(password)
    await this.page.getByTestId('reset-submit').click()
  }
}
