import { TEXAS_HOME } from '../pages/AccountPage'
import { expect, test } from '../fixtures'

test.describe('profile & password (ACC-05) @account', () => {
  test.beforeEach(async ({ accountPage, signedInUser }) => {
    await accountPage.goto()
    await expect(accountPage.heading).toHaveText(`Hi, ${signedInUser.firstName}`)
  })

  test('edit name updates the greeting and header', async ({ accountPage, page }) => {
    await accountPage.updateProfile('Jordan', 'Rivers')
    await expect(page.getByTestId('profile-message')).toHaveText('Profile saved.')
    await expect(accountPage.heading).toHaveText('Hi, Jordan')
    await expect(page.getByTestId('nav-user-name')).toHaveText('Jordan')
  })

  test('change password: stays signed in here, old password stops working', async ({
    accountPage,
    signedInUser,
    loginPage,
    page,
  }) => {
    await accountPage.changePassword(signedInUser.password, 'Glitter456')
    await expect(page.getByTestId('password-message')).toContainText('Password changed')

    await page.reload()
    await expect(accountPage.heading).toBeVisible() // this device got a fresh session

    await page.getByTestId('nav-logout').click()
    await loginPage.goto()
    await loginPage.signIn(signedInUser.email, signedInUser.password)
    await expect(loginPage.error).toHaveText('Email or password is incorrect.')
    await loginPage.signIn(signedInUser.email, 'Glitter456')
    await expect(accountPage.heading).toBeVisible()
  })

  test('wrong current password is flagged on its field', async ({ accountPage, page }) => {
    await accountPage.changePassword('NotCurrent1', 'Glitter456')
    await expect(page.getByTestId('password-current-error')).toHaveText(
      'Current password is incorrect.',
    )
  })
})

test.describe('address book (ACC-05) @account', () => {
  test.beforeEach(async ({ accountPage, signedInUser: _ }) => {
    await accountPage.goto()
    await expect(accountPage.page.getByTestId('address-empty')).toBeVisible()
  })

  test('first address becomes the default @mobile', async ({ accountPage }) => {
    await accountPage.addAddress(TEXAS_HOME)
    await expect(accountPage.addressCards).toHaveCount(1)
    await expect(accountPage.card('Home')).toHaveAttribute('data-default', 'true')
    await expect(accountPage.card('Home')).toContainText('Austin, TX 78701')
  })

  test('switching the default moves the badge', async ({ accountPage }) => {
    await accountPage.addAddress(TEXAS_HOME)
    await accountPage.addAddress({ ...TEXAS_HOME, label: 'Work', line1: '500 E 5th St' })
    await expect(accountPage.card('Work')).toHaveAttribute('data-default', 'false')

    await accountPage.card('Work').getByTestId('address-make-default').click()
    await expect(accountPage.card('Work')).toHaveAttribute('data-default', 'true')
    await expect(accountPage.card('Home')).toHaveAttribute('data-default', 'false')
  })

  test('deleting the default promotes the next address', async ({ accountPage }) => {
    await accountPage.addAddress(TEXAS_HOME)
    await accountPage.addAddress({ ...TEXAS_HOME, label: 'Work' })
    await accountPage.card('Home').getByTestId('address-delete').click()

    await expect(accountPage.addressCards).toHaveCount(1)
    await expect(accountPage.card('Work')).toHaveAttribute('data-default', 'true')
  })

  test('edit an address', async ({ accountPage }) => {
    await accountPage.addAddress(TEXAS_HOME)
    await accountPage.card('Home').getByTestId('address-edit').click()
    await expect(accountPage.addressForm.getByTestId('address-state')).toHaveValue('TX')
    await accountPage.fillAddress({ city: 'Los Angeles', state: 'CA', postal: '90012' })
    await accountPage.addressForm.getByTestId('address-submit').click()
    await expect(accountPage.card('Home')).toContainText('Los Angeles, CA 90012')
  })

  test('invalid ZIP is rejected in the form', async ({ accountPage }) => {
    await accountPage.addButton.click()
    await accountPage.fillAddress({ ...TEXAS_HOME, postal: '7870' })
    await accountPage.addressForm.getByTestId('address-submit').click()
    await expect(accountPage.addressForm.getByTestId('address-postal-error')).toContainText(
      '5-digit ZIP',
    )
  })

  test('limit of five: Add is disabled after the fifth', async ({ accountPage }) => {
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      await accountPage.addAddress({ ...TEXAS_HOME, label: `Place ${label}` })
    }
    await expect(accountPage.addressCount).toContainText('5 of 5 saved')
    await expect(accountPage.addButton).toBeDisabled()
  })
})
