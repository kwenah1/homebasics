import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { GuestLine } from '../api/cart'
import { accountCartServer, cartOf, line, previewHandler, seedGuestCart, storedGuestCart } from '../test/cartFixtures'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

describe('guest cart page', () => {
  it('prices the stored guest cart via /cart/preview', async () => {
    const calls: GuestLine[][] = []
    server.use(previewHandler(calls))
    seedGuestCart([
      { product_id: 1, quantity: 2, price_cents_seen: 2499 },
      { product_id: 11, quantity: 3, price_cents_seen: 499 },
    ])
    renderApp('/cart')

    const lines = await screen.findAllByTestId('cart-line')
    expect(lines.map((l) => l.dataset.sku)).toEqual(['KIT-001', 'CLN-001'])
    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('$64.95')
    expect(screen.getByTestId('cart-count')).toHaveTextContent('5')
    expect(calls[0]).toEqual([
      { product_id: 1, quantity: 2, price_cents_seen: 2499 },
      { product_id: 11, quantity: 3, price_cents_seen: 499 },
    ])
    expect(screen.getByTestId('guest-hint')).toBeInTheDocument()
  })

  it('empty cart', async () => {
    renderApp('/cart')
    expect(await screen.findByTestId('cart-empty')).toHaveTextContent('Your cart is empty.')
  })

  it.each([
    [[{ product_id: 6, quantity: 1 }], 'Add $0.01 more'], // $49.99
    [[{ product_id: 6, quantity: 1 }, { product_id: 15, quantity: 1 }], 'qualifies for free standard shipping'],
    [[{ product_id: 11, quantity: 1 }], 'Add $45.01 more'],
  ])('free-shipping message for %j', async (lines, text) => {
    server.use(previewHandler())
    seedGuestCart(lines)
    renderApp('/cart')
    expect(await screen.findByTestId('free-shipping')).toHaveTextContent(text)
  })

  it('removing a line updates storage and the header count', async () => {
    server.use(previewHandler())
    seedGuestCart([{ product_id: 1, quantity: 2 }, { product_id: 11, quantity: 1 }])
    renderApp('/cart')
    const [pan] = await screen.findAllByTestId('cart-line')
    await userEvent.click(within(pan).getByTestId('line-remove'))

    await waitFor(() => expect(screen.getAllByTestId('cart-line')).toHaveLength(1))
    expect(storedGuestCart()).toEqual([{ product_id: 11, quantity: 1 }])
    expect(screen.getByTestId('cart-count')).toHaveTextContent('1')
  })

  it('changing quantity rewrites storage', async () => {
    server.use(previewHandler())
    seedGuestCart([{ product_id: 1, quantity: 2 }])
    renderApp('/cart')
    await userEvent.selectOptions(await screen.findByTestId('line-qty'), '7')
    await waitFor(() => expect(storedGuestCart()).toEqual([{ product_id: 1, quantity: 7 }]))
  })

  it('shows a price change and clears it on acknowledge (CRT-03)', async () => {
    server.use(previewHandler())
    seedGuestCart([{ product_id: 1, quantity: 1, price_cents_seen: 1999 }]) // now 24.99
    renderApp('/cart')
    expect(await screen.findByTestId('line-price-change')).toHaveTextContent('Price went up from $19.99 to $24.99')
    await userEvent.click(screen.getByTestId('acknowledge-prices'))
    await waitFor(() => expect(screen.queryByTestId('price-change-notice')).not.toBeInTheDocument())
    expect(storedGuestCart()[0].price_cents_seen).toBe(2499)
  })

  it('prunes products the server no longer knows', async () => {
    server.use(previewHandler())
    seedGuestCart([{ product_id: 1, quantity: 1 }, { product_id: 999, quantity: 1 }])
    renderApp('/cart')
    await screen.findByTestId('cart-line')
    await waitFor(() => expect(storedGuestCart()).toEqual([{ product_id: 1, quantity: 1 }]))
  })

  it('a corrupted guest cart does not break the page', async () => {
    localStorage.setItem('hb_guest_cart_v1', '{"oops": tru')
    renderApp('/cart')
    expect(await screen.findByTestId('cart-empty')).toBeInTheDocument()
  })
})

describe('account cart page', () => {
  it('flags problem lines and blocks checkout (CRT-04)', async () => {
    server.use(
      ...signedIn(),
      http.get('/api/v1/cart', () =>
        HttpResponse.json(
          cartOf([
            line(1, 4, { issue: 'insufficient_stock', available: 2 }),
            line(11, 1),
            line(6, 1, { issue: 'unavailable', max_order_qty: 0 }),
          ]),
        ),
      ),
    )
    renderApp('/cart')
    const lines = await screen.findAllByTestId('cart-line')
    expect(within(lines[0]).getByTestId('line-issue')).toHaveTextContent('Only 2 available')
    expect(within(lines[2]).getByTestId('line-issue')).toHaveTextContent('No longer sold')
    expect(within(lines[2]).getByTestId('line-qty')).toBeDisabled()
    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('$4.99') // only the healthy line
    expect(screen.getByTestId('cart-has-issues')).toBeInTheDocument()
    expect(screen.getByTestId('checkout')).toBeDisabled()
  })

  it('shows a server refusal on the line', async () => {
    server.use(
      ...signedIn(),
      http.get('/api/v1/cart', () => HttpResponse.json(cartOf([line(1, 2)]))),
      http.patch('/api/v1/cart/items/1', () =>
        apiError(409, 'insufficient_stock', 'Only 3 available.', { available: 3 }),
      ),
    )
    renderApp('/cart')
    await userEvent.selectOptions(await screen.findByTestId('line-qty'), '8')
    expect(await screen.findByTestId('line-error')).toHaveTextContent('Only 3 available.')
  })
})

describe('merge at sign-in (CRT-02)', () => {
  it('sends the guest cart once, clears it and shows the report', async () => {
    const fake = accountCartServer({
      cart: cartOf([line(1, 10)]),
      report: {
        capped: [{ product_id: 1, requested: 12, kept: 10 }],
        skipped: [{ product_id: 9, reason: 'out_of_stock' }],
      },
    })
    server.use(...signedIn(), ...fake.handlers)
    seedGuestCart([{ product_id: 1, quantity: 6 }, { product_id: 9, quantity: 1 }])
    renderApp('/cart')

    expect(await screen.findByTestId('merge-report')).toBeInTheDocument()
    expect(screen.getByTestId('merge-capped')).toHaveTextContent('1 item was reduced')
    expect(screen.getByTestId('merge-skipped')).toHaveTextContent("1 item isn't available")
    expect(fake.merges).toEqual([{ items: [{ product_id: 1, quantity: 6 }, { product_id: 9, quantity: 1 }] }])
    expect(localStorage.getItem('hb_guest_cart_v1')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('cart-count')).toHaveTextContent('10'))

    await userEvent.click(screen.getByTestId('merge-dismiss'))
    expect(screen.queryByTestId('merge-report')).not.toBeInTheDocument()
  })

  it('a clean merge shows no report', async () => {
    const fake = accountCartServer({ cart: cartOf([line(1, 2)]), report: { capped: [], skipped: [] } })
    server.use(...signedIn(), ...fake.handlers)
    seedGuestCart([{ product_id: 1, quantity: 2 }])
    renderApp('/cart')
    expect(await screen.findByTestId('cart-line')).toBeInTheDocument()
    expect(screen.queryByTestId('merge-report')).not.toBeInTheDocument()
    expect(fake.merges).toHaveLength(1) // exactly once, even under StrictMode-style re-renders
  })

  it('a failed merge keeps the guest cart and offers a retry', async () => {
    let attempts = 0
    const fake = accountCartServer(() => {
      attempts++
      return attempts === 1
        ? apiError(503, 'http_error')
        : { cart: cartOf([line(1, 2)]), report: { capped: [], skipped: [] } }
    })
    server.use(...signedIn(), ...fake.handlers)
    seedGuestCart([{ product_id: 1, quantity: 2 }])
    renderApp('/cart')

    expect(await screen.findByTestId('merge-failed')).toBeInTheDocument()
    expect(storedGuestCart()).toEqual([{ product_id: 1, quantity: 2 }])

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('cart-line')).toBeInTheDocument()
    expect(screen.queryByTestId('merge-failed')).not.toBeInTheDocument()
    expect(attempts).toBe(2)
    expect(localStorage.getItem('hb_guest_cart_v1')).toBeNull()
  })
})