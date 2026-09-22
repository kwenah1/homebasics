import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { ADMIN_USER } from './api'

export function tag() {
  return `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`
}

export async function signInAsAdmin(page: Page) {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: ADMIN_USER.email, password: ADMIN_USER.password },
  })
  expect(response.ok()).toBeTruthy()
}

export async function createProductInUi(page: Page, opts: { price: string; stock: string }) {
  const t = tag()
  const name = `E2E Scrub Brush ${t}`
  await page.goto('/admin/products/new')
  await page.getByTestId('admin-product-sku').fill(`E2E-${t}`.slice(0, 21))
  await page.getByTestId('admin-product-name').fill(name)
  await page.getByTestId('admin-product-description').fill('Stiff bristles.')
  await page.getByTestId('admin-product-price').fill(opts.price)
  await page.getByTestId('admin-product-stock-input').fill(opts.stock)
  await page.getByTestId('admin-product-save').click()
  await expect(page.getByTestId('admin-notice')).toHaveText('Product created and on sale.')
  const slug = await page.getByTestId('admin-view-in-store').getAttribute('href')
  return { name, slug: slug!.replace('/p/', ''), url: page.url() }
}
