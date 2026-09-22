import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { Order } from '../api/orders'
import { orderFor } from '../test/orderFixtures'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

function orderServer(initial: Order, pay?: (body: Record<string, unknown>, key: string | null, n: number) => Response) {
  let current = initial
  const pays: { body: Record<string, unknown>; key: string | null }[] = []
  server.use(
    ...signedIn(),
    http.get(`/api/v1/orders/${initial.order_number}`, () => HttpResponse.json(current)),
    http.post(`/api/v1/orders/${initial.order_number}/pay`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      const key = request.headers.get('Idempotency-Key')
      pays.push({ body, key })
      if (pay) return pay(body, key, pays.length)
      current = { ...current, status: 'paid', can_pay: false }
      return HttpResponse.json(current)
    }),
    http.post(`/api/v1/orders/${initial.order_number}/cancel`, () => {
      current = { ...current, status: 'cancelled', can_pay: false, can_cancel: false }
      return HttpResponse.json(current)
    }),
  )
  return { pays, set: (o: Order) => (current = o) }
}

async function fillCard(number = '4242 4242 4242 4242', expiry = '12/35') {
  const user = userEvent.setup()
  await user.type(await screen.findByTestId('card-number'), number)
  await user.type(screen.getByTestId('card-expiry'), expiry)
  await user.type(screen.getByTestId('card-cvc'), '123')
  await user.type(screen.getByTestId('card-name'), 'Casey Customer')
  await user.click(screen.getByTestId('pay-submit'))
}

describe('PayPage', () => {
  it('pays and lands on the confirmed order', async () => {
    const { pays } = orderServer(orderFor())
    renderApp('/orders/HB-ABCD2345/pay')
    expect(await screen.findByTestId('pay-countdown')).toHaveTextContent(/Time left to pay: (29|30):\d\d/)
    await fillCard()

    expect(await screen.findByTestId('order-thanks')).toHaveTextContent('HB-ABCD2345 is confirmed')
    expect(pays[0].body).toEqual({
      card_number: '4242 4242 4242 4242',
      exp_month: 12,
      exp_year: 2035,
      cvc: '123',
      name_on_card: 'Casey Customer',
    })
    expect(pays[0].key).toMatch(/^[a-f0-9]{32}$/)
  })

  it('a test card can be filled with one click', async () => {
    orderServer(orderFor())
    renderApp('/orders/HB-ABCD2345/pay')
    await userEvent.click(await screen.findByTestId('use-card-0002'))
    expect(screen.getByTestId('card-number')).toHaveValue('4000 0000 0000 0002')
  })

  it('validates the card before sending anything', async () => {
    const { pays } = orderServer(orderFor())
    renderApp('/orders/HB-ABCD2345/pay')
    await fillCard('4242 4242 4242 4241', '01/20')
    expect(await screen.findByTestId('card-number-error')).toHaveTextContent('Check the card number.')
    expect(screen.getByTestId('card-expiry-error')).toHaveTextContent('This card has expired.')
    expect(pays).toHaveLength(0)
  })

  it('a decline is explained and a retry uses a new key', async () => {
    const { pays } = orderServer(orderFor(), (_b, _k, n) =>
      n === 1
        ? apiError(402, 'card_declined', 'Your card was declined.', { can_retry: true })
        : HttpResponse.json(orderFor({ status: 'paid', can_pay: false })),
    )
    renderApp('/orders/HB-ABCD2345/pay')
    await fillCard('4000 0000 0000 0002')
    expect(await screen.findByTestId('pay-error')).toHaveTextContent('Your card was declined.')

    await userEvent.click(screen.getByTestId('pay-submit'))
    await waitFor(() => expect(pays).toHaveLength(2))
    expect(pays[1].key).not.toBe(pays[0].key)
  })

  it('shows the closed window when the server says the order expired', async () => {
    orderServer(orderFor(), () => apiError(409, 'order_expired', 'closed'))
    renderApp('/orders/HB-ABCD2345/pay')
    await fillCard()
    expect(await screen.findByTestId('pay-expired')).toBeInTheDocument()
  })

  it('an order that is already paid goes straight to its page', async () => {
    orderServer(orderFor({ status: 'paid', can_pay: false }))
    renderApp('/orders/HB-ABCD2345/pay')
    expect(await screen.findByTestId('order-detail')).toBeInTheDocument()
  })
})

describe('OrderDetailPage', () => {
  it('cancel asks for confirmation, then shows the new status', async () => {
    orderServer(orderFor())
    renderApp('/orders/HB-ABCD2345')
    await userEvent.click(await screen.findByTestId('order-cancel'))
    expect(screen.getByRole('group', { name: 'Confirm cancellation' })).toHaveTextContent('Cancel this order?')

    await userEvent.click(screen.getByTestId('order-cancel-keep'))
    expect(screen.queryByTestId('order-cancel-confirm')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('order-cancel'))
    await userEvent.click(screen.getByTestId('order-cancel-confirm'))
    await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent('Cancelled'))
    expect(screen.queryByTestId('order-cancel')).not.toBeInTheDocument()
  })

  it('a paid order warns that cancelling refunds, and shows the refund', async () => {
    const { set } = orderServer(orderFor({ status: 'paid', can_pay: false }))
    renderApp('/orders/HB-ABCD2345')
    await userEvent.click(await screen.findByTestId('order-cancel'))
    expect(screen.getByRole('group', { name: 'Confirm cancellation' })).toHaveTextContent('and refund your payment')
    set(
      orderFor({
        status: 'cancelled',
        can_pay: false,
        can_cancel: false,
        payments: [
          { status: 'succeeded', amount_cents: 6009, card_last4: '4242', failure_reason: null, at: '2026-09-21T15:01:00Z' },
          { status: 'refunded', amount_cents: 6009, card_last4: '4242', failure_reason: null, at: '2026-09-21T15:05:00Z' },
        ],
      }),
    )
    server.use(
      http.post('/api/v1/orders/HB-ABCD2345/cancel', () =>
        HttpResponse.json(
          orderFor({
            status: 'cancelled',
            can_pay: false,
            can_cancel: false,
            payments: [{ status: 'refunded', amount_cents: 6009, card_last4: '4242', failure_reason: null, at: '2026-09-21T15:05:00Z' }],
          }),
        ),
      ),
    )
    await userEvent.click(screen.getByTestId('order-cancel-confirm'))
    expect(await screen.findByTestId('order-refund')).toHaveTextContent('Refunded $60.09 to card ending 4242.')
  })

  it('shows totals, address and history; no actions on a shipped order', async () => {
    orderServer(
      orderFor({
        status: 'shipped',
        can_pay: false,
        can_cancel: false,
        history: [
          { from_status: null, to_status: 'pending_payment', at: '2026-09-21T15:00:00Z', note: 'Order placed' },
          { from_status: 'pending_payment', to_status: 'paid', at: '2026-09-21T15:01:00Z', note: null },
          { from_status: 'paid', to_status: 'shipped', at: '2026-09-22T09:00:00Z', note: null },
        ],
      }),
    )
    renderApp('/orders/HB-ABCD2345')
    expect(await screen.findByTestId('order-total')).toHaveTextContent('$60.09')
    expect(screen.getByTestId('order-ship-to')).toHaveTextContent('Austin, TX 78701')
    expect(within(screen.getByTestId('order-history')).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByTestId('order-cancel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('order-pay')).not.toBeInTheDocument()
  })

  it("someone else's order number shows not-found", async () => {
    server.use(...signedIn(), http.get('/api/v1/orders/HB-NOTMINE2', () => apiError(404, 'order_not_found')))
    renderApp('/orders/HB-NOTMINE2')
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })
})

describe('OrdersPage', () => {
  it('lists orders with status and totals', async () => {
    server.use(
      ...signedIn(),
      http.get('/api/v1/orders', () =>
        HttpResponse.json({
          items: [
            { order_number: 'HB-NEWER222', status: 'paid', placed_at: '2026-09-21T16:00:00Z', item_count: 3, total_cents: 1500 },
            { order_number: 'HB-OLDER222', status: 'expired', placed_at: '2026-09-20T16:00:00Z', item_count: 1, total_cents: 999 },
          ],
          total: 2,
          page: 1,
          page_size: 10,
        }),
      ),
    )
    renderApp('/orders')
    const rows = await screen.findAllByTestId('order-row')
    expect(rows.map((r) => r.dataset.order)).toEqual(['HB-NEWER222', 'HB-OLDER222'])
    expect(within(rows[0]).getByTestId('order-status')).toHaveTextContent('Paid')
    expect(within(rows[1]).getByTestId('order-status')).toHaveTextContent('Expired')
    expect(rows[0]).toHaveTextContent('3 items')
  })
})
