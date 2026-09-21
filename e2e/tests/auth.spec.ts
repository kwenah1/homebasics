import { expect, test } from '../fixtures'
import { uniqueUser } from '../support/api'

test.describe('registration (ACC-01, ACC-02) @auth', () => {
  test('new shopper registers and lands on their account @smoke @mobile', async ({
    registerPage,
    accountPage,
    page,
  }) => {
    const shopper = uniqueUser({ firstName: 'Robin' })
    await registerPage.goto()
    await registerPage.registerAs(shopper)

    await expect(page).toHaveURL('/account')
    await expect(accountPage.heading).toHaveText('Hi, Robin')
    await expect(page.getByTestId('account-email')).toHaveText(shopper.email)
    await expect(page.getByTestId('nav-user-name')).toHaveText('Robin')
  })

  test('duplicate email (any case) is flagged on the email field', async ({
    registerPage,
    user,
  }) => {
    await registerPage.goto()
    await registerPage.registerAs({ ...uniqueUser(), email: user.email.toUpperCase() })
    await expect(registerPage.fieldError('email')).toHaveText('This email is already registered.')
  })

  test('password rules are explained before submitting', async ({ registerPage, page }) => {
    await registerPage.goto()
    await registerPage.registerAs(uniqueUser({ password: 'short' }))
    await expect(registerPage.fieldError('password')).toContainText('at least 8 characters')
    await expect(page).toHaveURL('/register')
  })
})

test.describe('sign in / sign out (ACC-03) @auth', () => {
  test('sign in, stay signed in across reload, then sign out', async ({
    loginPage,
    accountPage,
    user,
    page,
  }) => {
    await loginPage.goto()
    await loginPage.signIn(user.email, user.password)
    await expect(accountPage.heading).toHaveText(`Hi, ${user.firstName}`)

    await page.reload() // access token is memory-only; the refresh cookie restores it
    await expect(accountPage.heading).toHaveText(`Hi, ${user.firstName}`)

    await page.getByTestId('nav-logout').click()
    await expect(page.getByTestId('nav-login')).toBeVisible()
    await accountPage.goto()
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/)
  })

  test('protected page sends you to sign in and back again', async ({
    loginPage,
    user,
    page,
  }) => {
    await page.goto('/account')
    await expect(page).toHaveURL('/login?next=%2Faccount')
    await loginPage.signIn(user.email, user.password)
    await expect(page).toHaveURL('/account')
  })

  test('wrong password and unknown email show the same message', async ({ loginPage, user }) => {
    await loginPage.goto()
    await loginPage.signIn(user.email, 'NotMyPass1')
    const wrongPassword = await loginPage.error.textContent()

    await loginPage.signIn(`nobody.${Date.now()}@e2e.test`, 'NotMyPass1')
    await expect(loginPage.error).toHaveText(wrongPassword!)
    expect(wrongPassword).toBe('Email or password is incorrect.')
  })

  test('refresh cookie is httpOnly - page JavaScript cannot read it', async ({
    page,
    signedInUser: _,
  }) => {
    await page.goto('/')
    expect(await page.evaluate(() => document.cookie)).not.toContain('hb_refresh')
    const [cookie] = (await page.context().cookies()).filter((c) => c.name === 'hb_refresh')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' })
  })

  test('open redirect via ?next is blocked', async ({ loginPage, user, page }) => {
    await page.goto('/login?next=//evil.example/phish')
    await loginPage.signIn(user.email, user.password)
    await expect(page).toHaveURL('/account')
  })
})

test.describe('lockout (ACC-04) @auth', () => {
  test('fifth wrong password locks the account, even for the right password', async ({
    loginPage,
    user,
  }) => {
    await loginPage.goto()
    for (let attempt = 1; attempt <= 4; attempt++) {
      await loginPage.signIn(user.email, `Wrong${attempt}pass`)
      await expect(loginPage.error).toHaveText('Email or password is incorrect.')
    }
    await loginPage.signIn(user.email, 'Wrong5pass')
    await expect(loginPage.error).toContainText('Too many failed attempts. Try again in 15 minutes')

    await loginPage.signIn(user.email, user.password)
    await expect(loginPage.error).toContainText('Too many failed attempts')
  })
})

test.describe('password reset (ACC-06) @auth', () => {
  test('forgot -> email link -> new password -> sign in', async ({
    forgotPage,
    resetPage,
    loginPage,
    accountPage,
    api,
    user,
    page,
  }) => {
    await forgotPage.goto()
    await forgotPage.request(user.email)
    await expect(forgotPage.confirmation).toBeVisible()

    const link = await api.resetLinkFor(user.email)
    expect(link).toMatch(/^http:\/\/localhost:5173\/reset-password\?token=/)
    await page.goto(link)
    await resetPage.choose('Brandnew99')

    await expect(loginPage.resetSuccess).toBeVisible()
    await loginPage.signIn(user.email, 'Brandnew99')
    await expect(accountPage.heading).toBeVisible()
  })

  test('a reset link only works once', async ({ forgotPage, resetPage, api, user, page }) => {
    await forgotPage.goto()
    await forgotPage.request(user.email)
    await expect(forgotPage.confirmation).toBeVisible()
    const link = await api.resetLinkFor(user.email)

    await page.goto(link)
    await resetPage.choose('Brandnew99')
    await expect(page).toHaveURL('/login?reset=1')

    await page.goto(link)
    await resetPage.choose('Another99x')
    await expect(resetPage.invalid).toBeVisible()
  })

  test('unknown email gets the same confirmation and no email', async ({ forgotPage, api }) => {
    const ghost = `ghost.${Date.now()}@e2e.test`
    await forgotPage.goto()
    await forgotPage.request(ghost)
    await expect(forgotPage.confirmation).toBeVisible()
    expect(await api.latestEmail(ghost)).toBeUndefined()
  })
})
