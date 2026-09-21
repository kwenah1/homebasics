import { expect, test } from '../fixtures'

const CATEGORY_SLUGS = ['kitchen', 'cleaning', 'bath', 'laundry', 'storage', 'paper-goods']

test.describe('storefront smoke @smoke', () => {
  test('home page loads with branding and six categories @mobile', async ({ homePage, page }) => {
    await homePage.goto()

    await expect(page).toHaveTitle('HomeBasics')
    await expect(homePage.heading).toHaveText(/everyday essentials/i)
    await expect(homePage.categoryTiles).toHaveCount(CATEGORY_SLUGS.length)
    await expect(homePage.cartCount).toHaveText('0')
  })

  test('footer shows the live API is online (full-stack check)', async ({ homePage }) => {
    await homePage.goto()
    await expect(homePage.apiStatus).toHaveAttribute('data-state', 'online')
    await expect(homePage.apiStatus).toContainText(/v\d+\.\d+\.\d+/)
  })

  for (const slug of CATEGORY_SLUGS) {
    test(`category tile "${slug}" navigates and highlights nav`, async ({ homePage, page }) => {
      await homePage.goto()
      await homePage.categoryTile(slug).click()

      await expect(page).toHaveURL(`/c/${slug}`)
      await expect(homePage.categoryNav(slug)).toHaveClass(/font-semibold/)
    })
  }

  test('unknown URL shows 404 with a link home', async ({ page, homePage }) => {
    await page.goto('/definitely/not/a/page')
    await expect(page.getByTestId('not-found')).toBeVisible()

    await page.getByRole('link', { name: 'Back to the store' }).click()
    await expect(page).toHaveURL('/')
    await expect(homePage.heading).toBeVisible()
  })

  test('shows offline status when the API is down', async ({ page, homePage }) => {
    // Network-level stub: proves the UI handles an outage without stopping the real API.
    await page.route('**/api/v1/health', (route) => route.abort('connectionrefused'))
    await homePage.goto()
    await expect(homePage.apiStatus).toHaveAttribute('data-state', 'offline')
  })
})
