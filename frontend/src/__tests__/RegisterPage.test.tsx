import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../test/render'
import { apiError, casey, server, tokenFor } from '../test/server'

async function fill(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    'register-first-name': 'Casey',
    'register-last-name': 'Customer',
    'register-email': 'new@homebasics.test',
    'register-password': 'Sparkle123',
    'register-confirm-password': 'Sparkle123',
    ...overrides,
  }
  const user = userEvent.setup()
  for (const [testId, value] of Object.entries(values)) {
    if (value) await user.type(await screen.findByTestId(testId), value)
  }
  await user.click(screen.getByTestId('register-submit'))
}

describe('RegisterPage', () => {
  it('explains every missing password rule', async () => {
    renderApp('/register')
    await fill({ 'register-password': 'abc', 'register-confirm-password': 'abc' })
    expect(await screen.findByTestId('register-password-error')).toHaveTextContent(
      'Password needs at least 8 characters, at least one number.',
    )
  })

  it('requires matching confirmation', async () => {
    renderApp('/register')
    await fill({ 'register-confirm-password': 'Sparkle124' })
    expect(await screen.findByTestId('register-confirm-password-error')).toHaveTextContent(
      'Passwords do not match.',
    )
  })

  it('maps a 409 email_taken onto the email field', async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        apiError(409, 'email_taken', 'exists', {
          fields: { email: 'This email is already registered.' },
        }),
      ),
    )
    renderApp('/register')
    await fill({ 'register-email': 'customer@homebasics.test' })
    expect(await screen.findByTestId('register-email-error')).toHaveTextContent(
      'This email is already registered.',
    )
    expect(screen.queryByTestId('register-error')).not.toBeInTheDocument()
  })

  it('sends the right payload (no confirm_password) and signs in', async () => {
    let payload: unknown
    server.use(
      http.post('/api/v1/auth/register', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json(tokenFor(), { status: 201 })
      }),
      http.get('/api/v1/me', () => HttpResponse.json(casey)),
    )
    renderApp('/register')
    await fill({ 'register-first-name': '  Casey  ' })

    expect(await screen.findByTestId('account-heading')).toHaveTextContent('Hi, Casey')
    expect(payload).toEqual({
      first_name: 'Casey',
      last_name: 'Customer',
      email: 'new@homebasics.test',
      password: 'Sparkle123',
    })
  })
})
