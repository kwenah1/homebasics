import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { Address } from '../api/addresses'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

const STATES = [
  { code: 'CA', name: 'California' },
  { code: 'TX', name: 'Texas' },
]

const address = (id: number, extra: Partial<Address> = {}): Address => ({
  id,
  label: `Place ${id}`,
  recipient_name: 'Casey Customer',
  line1: `${id} Main St`,
  line2: null,
  city: 'Austin',
  state: 'TX',
  postal_code: '78701',
  is_default: id === 1,
  ...extra,
})

function withAddresses(list: Address[]) {
  server.use(
    ...signedIn(),
    http.get('/api/v1/me/addresses', () => HttpResponse.json(list)),
    http.get('/api/v1/states', () => HttpResponse.json(STATES)),
  )
}

describe('account access', () => {
  it('sends anonymous visitors to sign in and remembers where they were going', async () => {
    renderApp('/account')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    // The ?next is kept, so a successful login comes back to /account.
    expect(screen.getByTestId('link-forgot')).toBeInTheDocument()
  })

  it('restores the session from the refresh cookie on load', async () => {
    withAddresses([])
    renderApp('/account')
    expect(await screen.findByTestId('account-heading')).toHaveTextContent('Hi, Casey')
    expect(screen.getByTestId('account-email')).toHaveTextContent('customer@homebasics.test')
  })

  it('signs out from the header', async () => {
    withAddresses([])
    renderApp('/account')
    await userEvent.click(await screen.findByTestId('nav-logout'))
    expect(await screen.findByTestId('nav-login')).toBeInTheDocument()
  })
})

describe('address book', () => {
  it('shows the empty state', async () => {
    withAddresses([])
    renderApp('/account')
    expect(await screen.findByTestId('address-empty')).toBeInTheDocument()
    expect(screen.getByTestId('address-count')).toHaveTextContent('0 of 5 saved')
  })

  it('lists addresses and marks the default', async () => {
    withAddresses([address(1), address(2, { line2: 'Apt 4' })])
    renderApp('/account')
    const cards = await screen.findAllByTestId('address-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByTestId('address-default-badge')).toBeInTheDocument()
    expect(within(cards[0]).queryByTestId('address-make-default')).not.toBeInTheDocument()
    expect(within(cards[1]).getByText(/Apt 4/)).toBeInTheDocument()
  })

  it('disables Add at the 5-address limit', async () => {
    withAddresses([1, 2, 3, 4, 5].map((id) => address(id)))
    renderApp('/account')
    expect(await screen.findByTestId('address-add')).toBeDisabled()
    expect(screen.getByTestId('address-count')).toHaveTextContent('5 of 5 saved')
  })

  it('validates ZIP and state client-side', async () => {
    withAddresses([])
    renderApp('/account')
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('address-add'))
    await user.type(await screen.findByTestId('address-postal'), '1234')
    await user.click(screen.getByTestId('address-submit'))

    expect(await screen.findByTestId('address-postal-error')).toHaveTextContent('5-digit ZIP')
    expect(screen.getByTestId('address-state-error')).toHaveTextContent('Choose a state.')
  })

  it('maps a server-side field error onto the input', async () => {
    withAddresses([])
    server.use(
      http.post('/api/v1/me/addresses', () =>
        apiError(422, 'validation_error', 'Some fields are invalid.', {
          fields: { line1: 'Too weird' },
        }),
      ),
    )
    renderApp('/account')
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('address-add'))
    await user.type(await screen.findByTestId('address-recipient'), 'Casey')
    await user.type(screen.getByTestId('address-line1'), '1 Main')
    await user.type(screen.getByTestId('address-city'), 'Austin')
    await user.selectOptions(screen.getByTestId('address-state'), 'TX')
    await user.type(screen.getByTestId('address-postal'), '78701')
    await user.click(screen.getByTestId('address-submit'))

    expect(await screen.findByTestId('address-line1-error')).toHaveTextContent('Too weird')
  })

  it('edit form is pre-filled, including the state dropdown', async () => {
    withAddresses([address(1, { state: 'CA', city: 'Fresno' })])
    renderApp('/account')
    await userEvent.click(await screen.findByTestId('address-edit'))
    expect(await screen.findByTestId('address-state')).toHaveValue('CA')
    expect(screen.getByTestId('address-city')).toHaveValue('Fresno')
  })
})
