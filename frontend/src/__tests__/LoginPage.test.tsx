import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../test/render'
import { apiError, casey, server, signedIn, tokenFor } from '../test/server'

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByTestId('login-email'), email)
  await user.type(screen.getByTestId('login-password'), password)
  await user.click(screen.getByTestId('login-submit'))
}

function stubMe() {
  server.use(http.get('/api/v1/me', () => HttpResponse.json(casey)))
}

describe('LoginPage', () => {
  it('validates before calling the API', async () => {
    let called = false
    server.use(
      http.post('/api/v1/auth/login', () => {
        called = true
        return HttpResponse.json(tokenFor())
      }),
    )
    renderApp('/login')
    await userEvent.click(await screen.findByTestId('login-submit'))

    expect(await screen.findByTestId('login-email-error')).toHaveTextContent('Enter your email.')
    expect(screen.getByTestId('login-password-error')).toHaveTextContent('Enter your password.')
    expect(screen.getByTestId('login-email')).toHaveAttribute('aria-invalid', 'true')
    expect(called).toBe(false)
  })

  it('shows a generic message for bad credentials', async () => {
    server.use(http.post('/api/v1/auth/login', () => apiError(401, 'invalid_credentials')))
    renderApp('/login')
    await fillAndSubmit('customer@homebasics.test', 'wrong-pass1')
    expect(await screen.findByTestId('login-error')).toHaveTextContent(
      'Email or password is incorrect.',
    )
  })

  it.each([
    [900, 'Try again in 15 minutes'],
    [61, 'Try again in 2 minutes'],
    [30, 'Try again in 1 minute '],
  ])('explains the lockout (retry_after=%is)', async (seconds, text) => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        apiError(423, 'account_locked', 'locked', { retry_after_seconds: seconds }),
      ),
    )
    renderApp('/login')
    await fillAndSubmit('customer@homebasics.test', 'wrong-pass1')
    expect(await screen.findByTestId('login-error')).toHaveTextContent(text)
  })

  it('signs in, updates the header and goes to the account page', async () => {
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json(tokenFor())))
    stubMe()
    renderApp('/login')
    await fillAndSubmit('customer@homebasics.test', 'Customer123')

    expect(await screen.findByTestId('account-heading')).toHaveTextContent('Hi, Casey')
    expect(screen.getByTestId('nav-user-name')).toHaveTextContent('Casey')
    expect(screen.queryByTestId('nav-login')).not.toBeInTheDocument()
  })

  it('returns to the page in ?next after sign-in', async () => {
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json(tokenFor())))
    renderApp('/login?next=%2Fcart')
    await fillAndSubmit('customer@homebasics.test', 'Customer123')
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument()
  })

  it('ignores an off-site ?next (open redirect)', async () => {
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json(tokenFor())))
    stubMe()
    renderApp('/login?next=%2F%2Fevil.example')
    await fillAndSubmit('customer@homebasics.test', 'Customer123')
    expect(await screen.findByTestId('account-heading')).toBeInTheDocument()
  })

  it('skips the form when already signed in', async () => {
    server.use(...signedIn())
    renderApp('/login')
    expect(await screen.findByTestId('account-heading')).toBeInTheDocument()
  })

  it('disables the button while submitting', async () => {
    server.use(
      http.post('/api/v1/auth/login', async () => {
        await new Promise((r) => setTimeout(r, 50))
        return apiError(401, 'invalid_credentials')
      }),
    )
    renderApp('/login')
    await fillAndSubmit('customer@homebasics.test', 'Customer123')
    await waitFor(() => expect(screen.getByTestId('login-submit')).toBeDisabled())
    await waitFor(() => expect(screen.getByTestId('login-submit')).toBeEnabled())
  })
})
