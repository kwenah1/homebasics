import type { Locator, Page } from '@playwright/test'

import { BasePage } from './BasePage'

export class HomePage extends BasePage {
  readonly heading: Locator
  readonly categoryTiles: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByRole('heading', { level: 1 })
    this.categoryTiles = page.getByRole('region', { name: 'Shop by category' }).getByRole('link')
  }

  async goto() {
    await this.page.goto('/')
  }

  categoryTile(slug: string): Locator {
    return this.page.getByTestId(`category-tile-${slug}`)
  }
}
