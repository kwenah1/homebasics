/**
 * Tests that move the server clock. They run in the dedicated "isolated" project, which
 * starts only after every other project has finished (see playwright.config.ts), because
 * shifting the clock would expire tokens in tests running in parallel.
 */
import { expect, test } from '../../fixtures'

test.describe.configure({ mode: 'serial' })

test.afterEach(async ({ api }) => {
  await api.resetClock()
})

test('lockout lifts after 15 minutes (ACC-04)', async ({ loginPage, accountPage, api, user }) => {
  await loginPage.goto()
  for (let attempt = 1; attempt <= 5; attempt++) {
    await loginPage.signIn(user.email, `Wrong${attempt}pass`)
  }
  await expect(loginPage.error).toContainText('Too many failed attempts')

  await api.advanceClock(14 * 60)
  await loginPage.signIn(user.email, user.password)
  await expect(loginPage.error).toContainText('Try again in 1 minute')

  await api.advanceClock(60)
  await loginPage.signIn(user.email, user.password)
  await expect(accountPage.heading).toBeVisible()
})

test('expired access token is refreshed silently (ACC-03)', async ({
  accountPage,
  api,
  signedInUser,
  page,
}) => {
  await accountPage.goto()
  await expect(accountPage.heading).toHaveText(`Hi, ${signedInUser.firstName}`)

  await api.advanceClock(16 * 60) // access token (15 min) is now expired
  await accountPage.updateProfile('Later', 'Still')
  await expect(page.getByTestId('profile-message')).toHaveText('Profile saved.')
})

test('session ends after 7 days (ACC-03)', async ({ accountPage, api, signedInUser: _, page }) => {
  await accountPage.goto()
  await expect(accountPage.heading).toBeVisible()

  await api.advanceClock(7 * 24 * 3600)
  await page.reload()
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/)
})

test('reset link expires after 30 minutes (ACC-06)', async ({
  forgotPage,
  resetPage,
  api,
  user,
  page,
}) => {
  await forgotPage.goto()
  await forgotPage.request(user.email)
  await expect(forgotPage.confirmation).toBeVisible()
  const link = await api.resetLinkFor(user.email)

  await api.advanceClock(30 * 60)
  await page.goto(link)
  await resetPage.choose('Brandnew99')
  await expect(resetPage.invalid).toBeVisible()
})
