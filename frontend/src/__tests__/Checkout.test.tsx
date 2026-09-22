import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { cartOf, line, seedGuestCart } from '../test/cartFixtures'
import { orderFor, quoteFor, texas } from '../test/orderFixtures'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

type PlaceCall = { body: Record<string, unknown>; key: string | null }

function checkoutServer(opts: { place?: (call: PlaceCall, n: number) => Response } = {}) {
  const places: PlaceCall[] = []
  const quotes: unknown[] = []
  server.use(
    ...signedIn(),
    http.get('/api/v1/me/addresses', () => HttpResponse.json([texas])),
    http.post('/api/v1/checkout/quote', async ({ request }) => {
      const body = (await request.json()) as { shipping_method: string }
      quotes.push(body)
      return HttpResponse.json(
        body.shipping_method === 'express'
          ? quoteFor({ shipping_method: 'express', shipping_cents: 1499, total_cents: 6909 })
          : quoteFor(),
      )
    }),
    http.post('/api/v1/checkout/place-order', async ({ request }) => {
      const call = { body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') }
      places.push(call)
      return opts.place ? opts.place(call, places.length) : HttpResponse.json(orderFor(), { status: 201 })
    }),
    http.get('/api/v1/orders/HB-ABCD2345', () => HttpResponse.json(orderFor())),
  )
  return { places, quotes }
}

describe('CheckoutPage', () => {
  it('shows the Texas quote for the default address', async () => {
    checkoutServer()
    renderApp('/checkout')
    expect(await screen.findByTestId('summary-total')).toHaveTextContent('$60.09')
    expect(screen.getByTestId('summary-tax')).toHaveTextContent('$4.12')
    expect(screen.getByText('Tax (TX 8.25%)')).toBeInTheDocument()
    expect(screen.getByTestId('address-option-7')).toBeChecked()
    expect(screen.getByTestId('place-order')).toHaveTextContent('Place order - $60.09')
  })

  it('switching to express re-quotes', async () => {
    const { quotes } = checkoutServer()
    renderApp('/checkout')
    await screen.findByTestId('summary-total')
    await userEvent.click(screen.getByTestId('shipping-express'))
    await waitFor(() => expect(screen.getByTestId('summary-total')).toHaveTextContent('$69.09'))
    expect(quotes.at(-1)).toEqual({ address_id: 7, shipping_method: 'express' })
  })

  it('places the order with an Idempotency-Key and the total the shopper saw', async () => {
    const { places } = checkoutServer()
    renderApp('/checkout')
    await userEvent.click(await screen.findByTestId('place-order'))
    expect(await screen.findByTestId('pay-total')).toHaveTextContent('$60.09') // on the pay page
    expect(places[0].body).toEqual({ address_id: 7, shipping_method: 'standard', expected_total_cents: 6009 })
    expect(places[0].key).toMatch(/^[a-f0-9]{32}$/)
  })

  it('a network failure retry reuses the same key; a definitive refusal gets a new one', async () => {
    const { places } = checkoutServer({
      place: (_call, n) =>
        n === 1
          ? HttpResponse.error()
          : n === 2
            ? apiError(409, 'total_changed', 'changed', { expected_total_cents: 6009, current_total_cents: 6100 })
            : HttpResponse.json(orderFor(), { status: 201 }),
    })
    renderApp('/checkout')
    const button = await screen.findByTestId('place-order')

    await userEvent.click(button)
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('could not reach the store')
    await userEvent.click(screen.getByTestId('place-order'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('total changed')
    await waitFor(() => expect(screen.getByTestId('place-order')).toBeEnabled())
    await userEvent.click(screen.getByTestId('place-order'))
    await screen.findByTestId('pay-total')

    expect(places[1].key).toBe(places[0].key) // unknown outcome -> same key (safe replay)
    expect(places[2].key).not.toBe(places[1].key) // 409 was final -> new attempt, new key
  })

  it('lists every problem line when stock changed (CHK-04)', async () => {
    checkoutServer({
      place: () =>
        apiError(409, 'cart_has_issues', 'Some items can’t be ordered.', {
          lines: [
            { sku: 'KIT-001', issue: 'insufficient_stock', requested: 4, available: 2 },
            { sku: 'CLN-001', issue: 'out_of_stock', requested: 1, available: 0 },
          ],
        }),
    })
    renderApp('/checkout')
    await userEvent.click(await screen.findByTestId('place-order'))
    const lines = await screen.findByTestId('checkout-problem-lines')
    expect(lines).toHaveTextContent('KIT-001: only 2 left (you asked for 4)')
    expect(lines).toHaveTextContent('CLN-001: no longer available')
  })

  it('blocked cart cannot be ordered', async () => {
    checkoutServer()
    server.use(
      http.post('/api/v1/checkout/quote', () =>
        HttpResponse.json(quoteFor({ can_place_order: false, blocking_reason: 'Your cart is empty.' })),
      ),
    )
    renderApp('/checkout')
    expect(await screen.findByTestId('checkout-blocked')).toHaveTextContent('Your cart is empty.')
    expect(screen.getByTestId('place-order')).toBeDisabled()
  })

  it('no saved address: points to the address book', async () => {
    server.use(...signedIn(), http.get('/api/v1/me/addresses', () => HttpResponse.json([])))
    renderApp('/checkout')
    expect(await screen.findByTestId('checkout-no-address')).toBeInTheDocument()
  })

  it('waits for the sign-in cart merge before quoting (regression)', async () => {
    let finishMerge!: () => void
    const { quotes } = checkoutServer()
    server.use(
      http.post('/api/v1/cart/merge', async () => {
        await new Promise<void>((resolve) => (finishMerge = resolve))
        return HttpResponse.json({ cart: cartOf([line(1, 2)]), report: { capped: [], skipped: [] } })
      }),
      http.get('/api/v1/cart', () => HttpResponse.json(cartOf([line(1, 2)]))),
    )
    seedGuestCart([{ product_id: 1, quantity: 2 }])
    renderApp('/checkout')

    await screen.findByTestId('checkout-address')
    expect(quotes).toHaveLength(0) // nothing priced while the merge is in flight
    finishMerge()
    expect(await screen.findByTestId('summary-total')).toHaveTextContent('$60.09')
    expect(quotes.length).toBeGreaterThan(0)
  })

  it('guests are sent to sign in first', async () => {
    renderApp('/checkout')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
