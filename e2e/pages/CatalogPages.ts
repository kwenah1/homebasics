import type { Locator, Page } from '@playwright/test'

import { BasePage } from './BasePage'

export class ProductListPage extends BasePage {
  readonly heading: Locator
  readonly resultCount: Locator
  readonly cards: Locator
  readonly sort: Locator
  readonly empty: Locator
  readonly pageIndicator: Locator
  readonly nextPage: Locator
  readonly prevPage: Locator
  readonly headerSearch: Locator
  readonly activeFilters: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByTestId('list-heading')
    this.resultCount = page.getByTestId('result-count')
    this.cards = page.getByTestId('product-card')
    this.sort = page.getByTestId('sort')
    this.empty = page.getByTestId('list-empty')
    this.pageIndicator = page.getByTestId('page-indicator')
    this.nextPage = page.getByTestId('page-next')
    this.prevPage = page.getByTestId('page-prev')
    this.headerSearch = page.getByTestId('header-search')
    this.activeFilters = page.getByTestId('active-filters')
  }

  async goto(path = '/products') {
    await this.page.goto(path)
    await this.waitForResults()
  }

  /** The grid is stable once the count text is filled in and no placeholder page shows. */
  async waitForResults() {
    await this.resultCount.filter({ hasText: /\d+ products?/ }).waitFor()
    await this.page.locator('[data-testid="product-grid"][aria-busy="true"]').waitFor({ state: 'detached' })
  }

  /**
   * Run a UI action and wait for the products response it triggers (optionally matching a
   * predicate on its query string), then for the grid to settle. A DOM-only wait would race:
   * the previous results stay on screen until the new ones arrive.
   * Only use it for actions that request a *new* query - a query React Query already has
   * cached in this browser context makes no request, so there is no response to wait for.
   */
  async afterFetch(action: () => Promise<unknown>, match: (q: URLSearchParams) => boolean = () => true) {
    const response = this.page.waitForResponse(
      (r) => r.url().includes('/api/v1/products?') && match(new URL(r.url()).searchParams),
    )
    await action()
    await response
    await this.waitForResults()
  }

  async search(term: string) {
    await this.afterFetch(
      async () => {
        await this.headerSearch.fill(term)
        await this.headerSearch.press('Enter')
      },
      (q) => q.get('q') === term.trim(),
    )
  }

  async setPriceRange(min: string, max: string) {
    await this.page.getByTestId('filter-min').fill(min)
    await this.page.getByTestId('filter-max').fill(max)
    await this.afterFetch(() => this.page.getByTestId('filter-apply').click())
  }

  async toggleInStock() {
    await this.afterFetch(() => this.page.getByTestId('filter-in-stock').click())
  }

  async sortBy(value: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'rating') {
    await this.afterFetch(() => this.sort.selectOption(value), (q) => q.get('sort') === value)
  }

  async goToNextPage() {
    await this.afterFetch(() => this.nextPage.click())
  }

  async total(): Promise<number> {
    return Number((await this.resultCount.textContent())?.match(/\d+/)?.[0])
  }

  async skus(): Promise<string[]> {
    return this.cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-sku') ?? ''))
  }

  async prices(): Promise<number[]> {
    const texts = await this.cards.getByTestId('product-price').allTextContents()
    return texts.map((t) => Math.round(Number(t.replace(/[$,]/g, '')) * 100))
  }

  card(sku: string): Locator {
    return this.page.locator(`[data-testid="product-card"][data-sku="${sku}"]`)
  }
}

export class ProductDetailPage extends BasePage {
  readonly name: Locator
  readonly price: Locator
  readonly stock: Locator
  readonly quantity: Locator
  readonly addToCart: Locator

  constructor(page: Page) {
    super(page)
    this.name = page.getByTestId('detail-name')
    this.price = page.getByTestId('detail-price')
    this.stock = page.getByTestId('stock-badge')
    this.quantity = page.getByTestId('detail-qty')
    this.addToCart = page.getByTestId('add-to-cart')
  }

  async goto(slug: string) {
    await this.page.goto(`/p/${slug}`)
  }
}
