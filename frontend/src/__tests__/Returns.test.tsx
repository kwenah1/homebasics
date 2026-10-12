import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { ReturnRequest } from '../api/returns'
import { orderFor } from '../test/orderFixtures'
import { renderApp } from '../test/render'
import { apiError, server, signedIn } from '../test/server'

const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString()

const delivered = orderFor({
  status: 'delivered',
  delivered_at: '2026-09-20T10:00:00Z',
  can_pay: false,
  can_cancel: false,
  return_window: {
    status: 'open',
    can_return: true,
    return_by: inTenDays,
    returnable: [{ product_id: 1, sku: 'KIT-001', product_name: 'Nonstick Frying Pan 10in', quantity: 2 }],
  },
})

const ret = (overrides: Partial<ReturnRequest> = {}): ReturnRequest => ({
  return_number: 'RT-ABCD2345',
  order_number: delivered.order_number,
  status: 'requested',
  reason: 'damaged',
  note: null,
  staff_note: null,
  items: [{ product_id: 1, sku: 'KIT-001', product_name: 'Nonstick Frying Pan 10in', unit_price_cents: 2499, quantity: 1 }],
  value_cents: 2499,
  refund_cents: null,
  restocked: null,
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  can_cancel: true,
  ...overrides,
})

function orderServer(order = delivered, returns: ReturnRequest[] = []) {
  server.use(
    ...signedIn(),
    http.get(`/api/v1/orders/${order.order_number}`, () => HttpResponse.json(order)),
    http.get(`/api/v1/orders/${order.order_number}/returns`, () => HttpResponse.json(returns)),
  )
}

describe('Returns on the order page (RET)', () => {
  it('no returns section before delivery', async () => {
    orderServer(orderFor({ status: 'paid' }))
    renderApp(`/orders/${delivered.order_number}`)
    await screen.findByTestId('order-detail')
    expect(screen.queryByTestId('order-returns')).not.toBeInTheDocument()
  })

  it('requests a return: choose quantity and a reason', async () => {
    const sent: unknown[] = []
    orderServer()
    server.use(
      http.post(`/api/v1/orders/${delivered.order_number}/returns`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json(ret(), { status: 201 })
      }),
    )
    renderApp(`/orders/${delivered.order_number}`)
    expect(await screen.findByTestId('return-by')).toHaveTextContent('You can return items until')
    await userEvent.click(screen.getByTestId('return-start'))
    await userEvent.click(screen.getByTestId('return-submit'))
    expect(await screen.findByTestId('return-error')).toHaveTextContent('Choose at least one item')
    await userEvent.selectOptions(screen.getByTestId('return-qty-KIT-001'), '1')
    await userEvent.click(screen.getByTestId('return-submit'))
    expect(await screen.findByTestId('return-error')).toHaveTextContent('Tell us why')
    await userEvent.selectOptions(screen.getByTestId('return-reason'), 'damaged')
    await userEvent.type(screen.getByTestId('return-note'), 'Handle snapped')
    await userEvent.click(screen.getByTestId('return-submit'))
    await waitFor(() =>
      expect(sent).toEqual([{ items: [{ product_id: 1, quantity: 1 }], reason: 'damaged', note: 'Handle snapped' }]),
    )
    await waitFor(() => expect(screen.queryByTestId('return-form')).not.toBeInTheDocument())
  })

  it('shows a server refusal', async () => {
    orderServer()
    server.use(
      http.post(`/api/v1/orders/${delivered.order_number}/returns`, () =>
        apiError(409, 'return_window_closed', 'Returns are accepted for 30 days after delivery.'),
      ),
    )
    renderApp(`/orders/${delivered.order_number}`)
    await userEvent.click(await screen.findByTestId('return-start'))
    await userEvent.selectOptions(screen.getByTestId('return-qty-KIT-001'), '2')
    await userEvent.selectOptions(screen.getByTestId('return-reason'), 'other')
    await userEvent.click(screen.getByTestId('return-submit'))
    expect(await screen.findByTestId('return-error')).toHaveTextContent('30 days after delivery')
  })

  it('lists returns with their status and refund, and cancels an open one', async () => {
    let cancelled = false
    orderServer(delivered, [ret(), ret({ return_number: 'RT-DONE0000', status: 'received', refund_cents: 2434, can_cancel: false })])
    server.use(
      http.post('/api/v1/returns/RT-ABCD2345/cancel', () => {
        cancelled = true
        return HttpResponse.json(ret({ status: 'cancelled', can_cancel: false }))
      }),
    )
    renderApp(`/orders/${delivered.order_number}`)
    const rows = await screen.findAllByTestId('return-row')
    expect(rows[1]).toHaveTextContent('Received - refunded')
    expect(within(rows[1]).getByTestId('return-refund')).toHaveTextContent('Refunded $24.34')
    expect(within(rows[1]).queryByTestId('return-cancel')).not.toBeInTheDocument()
    await userEvent.click(within(rows[0]).getByTestId('return-cancel'))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('says when the window has closed', async () => {
    orderServer({
      ...delivered,
      // The server says closed, even though this date is in the browser's future.
      return_window: { status: 'closed', can_return: false, return_by: '2099-01-01T00:00:00Z', returnable: [] },
    })
    renderApp(`/orders/${delivered.order_number}`)
    expect(await screen.findByTestId('return-by')).toHaveTextContent('The return window closed on')
    expect(screen.queryByTestId('return-start')).not.toBeInTheDocument()
  })

  it('shows every refund and the coupon discount on the order', async () => {
    orderServer({
      ...delivered,
      discount_cents: 500,
      coupon_code: 'WELCOME10',
      payments: [
        { status: 'succeeded', amount_cents: 5468, card_last4: '4242', failure_reason: null, at: '' },
        { status: 'refunded', amount_cents: 2434, card_last4: '4242', failure_reason: null, at: '' },
        { status: 'refunded', amount_cents: 2435, card_last4: '4242', failure_reason: null, at: '' },
      ],
    })
    renderApp(`/orders/${delivered.order_number}`)
    expect(await screen.findByTestId('order-discount')).toHaveTextContent('−$5.00')
    expect(screen.getByText('Discount (WELCOME10)')).toBeInTheDocument()
    expect(screen.getAllByTestId('order-refund').map((r) => r.textContent)).toEqual([
      'Refunded $24.34 to card ending 4242.',
      'Refunded $24.35 to card ending 4242.',
    ])
  })
})
