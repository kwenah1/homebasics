/**
 * Phase 2 tests that touch global state: a public product rating (catalog tests sort by
 * rating) and the server clock (the 30-day return window). Run serially in "isolated".
 */
import { expect, test } from '../../fixtures'
import { signInAsAdmin } from '../../support/admin'

test.describe.configure({ mode: 'serial' })

const SPONGES = 'non-scratch-scrub-sponges-6-pk'

test.afterEach(async ({ api }) => {
  await api.resetClock()
})

test('a delivered purchase unlocks reviews; the rating updates and staff can remove it (REV, ADM-06)', async ({
  browser,
  page,
  api,
  shopper,
}) => {
  await page.goto(`/p/${SPONGES}`)
  await expect(page.getByTestId('review-not-eligible')).toBeVisible()
  const count = page.getByTestId('rating-count')
  const ratingsBefore = Number(await count.getAttribute('data-count'))

  await api.buyAndDeliver(shopper, SPONGES, 1)
  await page.reload()
  await page.getByTestId('review-star-5').check({ force: true })
  await page.getByTestId('review-title').fill('Last for weeks')
  await page.getByTestId('review-body').fill('Scrub hard without scratching.')
  await page.getByTestId('review-submit').click()
  await expect(page.getByTestId('my-review')).toContainText('Last for weeks')
  await expect(count).toHaveAttribute('data-count', String(ratingsBefore + 1))
  await expect(page.getByTestId('review-list').getByTestId('review').first()).toContainText(
    `${shopper.firstName} ${shopper.lastName[0]}.`,
  )

  const admin = await (await browser.newContext()).newPage()
  await admin.goto('/')
  await signInAsAdmin(admin)
  await admin.goto('/admin/reviews')
  const row = admin.getByTestId('admin-review').filter({ hasText: 'Last for weeks' })
  await row.getByTestId('admin-review-delete').click()
  await row.getByTestId('admin-review-confirm').click()
  await expect(admin.getByTestId('admin-notice')).toHaveText('Review removed.')
  await admin.context().close()

  await page.reload()
  await expect(count).toHaveAttribute('data-count', String(ratingsBefore))
})

test('the return window closes exactly 30 days after delivery (RET-01)', async ({ page, api, shopper, orderPage }) => {
  const orderNumber = await api.buyAndDeliver(shopper, SPONGES, 1)
  await orderPage.goto(orderNumber)
  await expect(page.getByTestId('return-start')).toBeVisible()

  await api.advanceClock(30 * 24 * 3600 + 5)
  // A month outlives the 7-day session - sign in again.
  const relogin = await page.request.post('/api/v1/auth/login', {
    data: { email: shopper.email, password: shopper.password },
  })
  expect(relogin.ok()).toBeTruthy()
  await orderPage.goto(orderNumber)
  await expect(page.getByTestId('return-by')).toContainText('The return window closed on')
  await expect(page.getByTestId('return-start')).toBeHidden()
})
