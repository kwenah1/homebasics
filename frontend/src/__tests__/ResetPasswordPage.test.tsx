import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../test/render'
import { apiError, server } from '../test/server'

async function submitNewPassword(password = 'Brandnew99') {
  const user = userEvent.setup()
  await user.type(await screen.findByTestId('reset-password'), password)
  await user.type(screen.getByTestId('reset-confirm-password'), password)
  await user.click(screen.getByTestId('reset-submit'))
}

describe('ForgotPasswordPage', () => {
  it('always shows the same neutral confirmation', async () => {
    server.use(
      http.post('/api/v1/auth/forgot-password', () =>
        HttpResponse.json({ message: 'ok' }, { status: 202 }),
      ),
    )
    renderApp('/forgot-password')
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('forgot-email'), 'anyone@homebasics.test')
    await user.click(screen.getByTestId('forgot-submit'))
    expect(await screen.findByTestId('forgot-sent')).toHaveTextContent(
      'If that email is registered',
    )
  })
})

describe('ResetPasswordPage', () => {
  it('without a token, explains and offers a new link', async () => {
    renderApp('/reset-password')
    expect(await screen.findByTestId('reset-invalid')).toBeInTheDocument()
    expect(screen.getByTestId('link-request-new')).toHaveAttribute('href', '/forgot-password')
  })

  it('sends token + password, then shows success on the sign-in page', async () => {
    let payload: unknown
    server.use(
      http.post('/api/v1/auth/reset-password', async ({ request }) => {
        payload = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/reset-password?token=tok_abc123xyz')
    await submitNewPassword()

    expect(await screen.findByTestId('reset-success')).toBeInTheDocument()
    expect(payload).toEqual({ token: 'tok_abc123xyz', new_password: 'Brandnew99' })
  })

  it('switches to the dead-link view when the server rejects the token', async () => {
    server.use(
      http.post('/api/v1/auth/reset-password', () => apiError(400, 'invalid_reset_token')),
    )
    renderApp('/reset-password?token=tok_used_already')
    await submitNewPassword()
    expect(await screen.findByTestId('reset-invalid')).toBeInTheDocument()
  })

  it('enforces the password policy client-side', async () => {
    renderApp('/reset-password?token=tok_abc123xyz')
    await submitNewPassword('password')
    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(
      'at least one number',
    )
  })
})
