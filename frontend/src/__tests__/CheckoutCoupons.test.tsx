import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { orderFor, quoteFor, texas } from '../test/orderFixtures'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

const WELCOME = { code: 'WELCOME10', description: '10% off your first order', discount_cents: 500 }
const withCoupon = quoteFor({ discount_cents: 500, coupon: WELCOME, tax_cents: 371, total_cents: 5468 })

type Body = Record<string, unknown>

function couponServer(opts: { quote?: (body: Body) => Response; place?: (body: Body) => Response } = {}) {
  const quotes: Body[] = []
  const places: Body[] = []
  server.use(
    ...signedIn(),
    http.get('/api/v1/me/addresses', () => HttpResponse.json([texas])),
    http.post('/api/v1/checkout/quote', async ({ request }) => {
      const body = (await request.json()) as Body
      quotes.push(body)
      if (opts.quote) return opts.quote(body)
      if (!body.coupon_code) return HttpResponse.json(quoteFor())
      // Like the real API: codes are case-insensitive.
      if (String(body.coupon_code).trim().toUpperCase() === 'WELCOME10') return HttpResponse.json(withCoupon)
      return apiError(422, 'coupon_rejected', "That code isn't valid.", {
        reason: 'invalid',
        fields: { coupon_code: "That code isn't valid." },
      })
    }),
    http.post('/api/v1/checkout/place-order', async ({ request }) => {
      const body = (await request.json()) as Body
      places.push(body)
      return opts.place ? opts.place(body) : HttpResponse.json(orderFor(), { status: 201 })
    }),
    http.get('/api/v1/orders/HB-ABCD2345', () => HttpResponse.json(orderFor())),
  )
  return { quotes, places }
}

async function apply(code: string) {
  await userEvent.type(await screen.findByTestId('coupon-input'), code)
  await userEvent.click(screen.getByTestId('coupon-apply'))
}

describe('Checkout coupons (CPN)', () => {
  it('applying a code re-prices the order and shows the discount', async () => {
    const { quotes } = couponServer()
    renderApp('/checkout')
    await screen.findByTestId('summary-total')
    await apply('welcome10')
    expect(await screen.findByTestId('coupon-applied')).toHaveTextContent('WELCOME10')
    expect(screen.getByTestId('summary-discount')).toHaveTextContent('−$5.00')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$54.68')
    expect(quotes.some((q) => q.coupon_code === 'welcome10')).toBe(true)
  })

  it('a rejected code explains why and keeps the old total', async () => {
    couponServer()
    renderApp('/checkout')
    await screen.findByTestId('summary-total')
    await apply('NOPE')
    expect(await screen.findByTestId('coupon-error')).toHaveTextContent("That code isn't valid.")
    expect(screen.getByTestId('coupon-input')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('$60.09')
    expect(screen.queryByTestId('summary-discount')).not.toBeInTheDocument()
  })

  it('places the order with the code the total was priced with', async () => {
    const { places } = couponServer()
    renderApp('/checkout')
    await apply('WELCOME10')
    await screen.findByTestId('coupon-applied')
    await userEvent.click(screen.getByTestId('place-order'))
    await waitFor(() => expect(places).toHaveLength(1))
    expect(places[0]).toEqual({
      address_id: 7,
      shipping_method: 'standard',
      expected_total_cents: 5468,
      coupon_code: 'WELCOME10',
    })
  })

  it('removing the code re-quotes without it', async () => {
    couponServer()
    renderApp('/checkout')
    await apply('WELCOME10')
    await userEvent.click(await screen.findByTestId('coupon-remove'))
    await waitFor(() => expect(screen.getByTestId('summary-total')).toHaveTextContent('$60.09'))
    expect(screen.getByTestId('coupon-input')).toBeInTheDocument()
  })

  it('a code refused at placement is dropped and the shopper sees the new total first', async () => {
    const { places } = couponServer({
      place: () =>
        apiError(422, 'coupon_rejected', 'That code has been used up.', {
          reason: 'exhausted',
          fields: { coupon_code: 'That code has been used up.' },
        }),
    })
    renderApp('/checkout')
    await apply('WELCOME10')
    await screen.findByTestId('coupon-applied')
    await userEvent.click(screen.getByTestId('place-order'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('can no longer be used')
    expect(await screen.findByTestId('coupon-error')).toHaveTextContent('used up')
    await waitFor(() => expect(screen.getByTestId('summary-total')).toHaveTextContent('$60.09'))
    expect(places).toHaveLength(1) // not retried behind the shopper's back
  })

  it('a code that stops fitting on re-quote is dropped with its reason', async () => {
    let n = 0
    couponServer({
      quote: (body) => {
        n += 1
        if (!body.coupon_code) return HttpResponse.json(quoteFor())
        // First check succeeds; after switching shipping the same code is refused.
        return n <= 2
          ? HttpResponse.json(withCoupon)
          : apiError(422, 'coupon_rejected', 'That code has expired.', { reason: 'expired' })
      },
    })
    renderApp('/checkout')
    await apply('WELCOME10')
    await screen.findByTestId('coupon-applied')
    await userEvent.click(screen.getByTestId('shipping-express'))
    expect(await screen.findByTestId('coupon-error')).toHaveTextContent('expired')
    expect(screen.queryByTestId('summary-discount')).not.toBeInTheDocument()
  })
})
