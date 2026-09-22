import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { User } from '../api/auth'
import type { AdminReview, Coupon } from '../api/admin'
import type { AdminReturn } from '../api/returns'
import { renderApp } from '../test/render'
import { apiError, casey, server, signedIn } from '../test/server'

const ada: User = { ...casey, id: 1, email: 'admin@homebasics.test', first_name: 'Ada', role: 'admin' }

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: 1,
  code: 'WELCOME10',
  description: '10% off your first order',
  kind: 'percent',
  percent_off: 10,
  amount_off_cents: null,
  min_subtotal_cents: 0,
  starts_at: null,
  expires_at: null,
  max_redemptions: null,
  per_user_limit: 1,
  is_active: true,
  uses: 3,
  state: 'active',
  ...overrides,
})

describe('admin coupons (ADM-05)', () => {
  it('lists coupons with uses and state', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/coupons', () =>
        HttpResponse.json([
          coupon(),
          coupon({ id: 2, code: 'SAVE5', kind: 'fixed', percent_off: null, amount_off_cents: 500, min_subtotal_cents: 3000, max_redemptions: 100, uses: 7 }),
        ]),
      ),
    )
    renderApp('/admin/coupons')
    const rows = await screen.findAllByTestId('admin-coupon-row')
    expect(rows[0]).toHaveTextContent('10% off')
    expect(rows[1]).toHaveTextContent('$5.00 off orders of $30.00+')
    expect(within(rows[1]).getByTestId('coupon-uses')).toHaveTextContent('7 / 100')
    expect(within(rows[0]).getByTestId('coupon-state')).toHaveTextContent('active')
  })

  it('creates a fixed coupon: dollars become cents, local times become UTC', async () => {
    const sent: Record<string, unknown>[] = []
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/coupons', () => HttpResponse.json([])),
      http.post('/api/v1/admin/coupons', async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(coupon({ code: 'TENOFF' }), { status: 201 })
      }),
    )
    renderApp('/admin/coupons')
    await userEvent.type(await screen.findByTestId('coupon-code'), 'tenoff')
    await userEvent.click(screen.getByTestId('coupon-kind-fixed'))
    await userEvent.type(screen.getByTestId('coupon-amount'), '10.50')
    await userEvent.clear(screen.getByTestId('coupon-min'))
    await userEvent.type(screen.getByTestId('coupon-min'), '40')
    await userEvent.type(screen.getByTestId('coupon-max'), '200')
    await userEvent.type(screen.getByTestId('coupon-expires'), '2026-12-31T23:59')
    await userEvent.click(screen.getByTestId('coupon-create'))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({
      code: 'tenoff',
      kind: 'fixed',
      amount_off_cents: 1050,
      min_subtotal_cents: 4000,
      per_user_limit: 1,
      max_redemptions: 200,
      expires_at: new Date('2026-12-31T23:59').toISOString(),
    })
    expect(sent[0]).not.toHaveProperty('percent_off')
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Created TENOFF.')
  })

  it('shows field errors from the server', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/coupons', () => HttpResponse.json([])),
      http.post('/api/v1/admin/coupons', () =>
        apiError(409, 'coupon_code_taken', 'That code is already used.', { fields: { code: 'Already used.' } }),
      ),
    )
    renderApp('/admin/coupons')
    await userEvent.type(await screen.findByTestId('coupon-code'), 'WELCOME10')
    await userEvent.type(screen.getByTestId('coupon-percent'), '10')
    await userEvent.click(screen.getByTestId('coupon-create'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('code: Already used.')
  })

  it('disables a coupon', async () => {
    const patches: unknown[] = []
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/coupons', () => HttpResponse.json([coupon()])),
      http.patch('/api/v1/admin/coupons/1', async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json(coupon({ is_active: false, state: 'disabled' }))
      }),
    )
    renderApp('/admin/coupons')
    await userEvent.click(await screen.findByTestId('coupon-toggle'))
    await waitFor(() => expect(patches).toEqual([{ is_active: false }]))
  })
})

const adminReturn = (overrides: Partial<AdminReturn> = {}): AdminReturn => ({
  return_number: 'RT-ABCD2345',
  order_number: 'HB-ABCD2345',
  status: 'requested',
  reason: 'no_longer_needed',
  note: 'Bought two by mistake',
  staff_note: null,
  items: [{ product_id: 1, sku: 'KIT-001', product_name: 'Nonstick Frying Pan 10in', unit_price_cents: 2499, quantity: 1 }],
  value_cents: 2499,
  refund_cents: null,
  restocked: null,
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  can_cancel: true,
  customer_email: 'customer@homebasics.test',
  customer_name: 'Casey Customer',
  ...overrides,
})

describe('admin returns (ADM-07)', () => {
  it('approve a requested return; reject needs a note', async () => {
    const calls: string[] = []
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/returns', ({ request }) => {
        calls.push(`list ${new URL(request.url).searchParams.get('status')}`)
        return HttpResponse.json([adminReturn()])
      }),
      http.post('/api/v1/admin/returns/RT-ABCD2345/approve', () => {
        calls.push('approve')
        return HttpResponse.json(adminReturn({ status: 'approved' }))
      }),
    )
    renderApp('/admin/returns')
    const card = await screen.findByTestId('admin-return')
    expect(card).toHaveTextContent('“Bought two by mistake”')
    expect(within(card).getByTestId('return-reject')).toBeDisabled()
    await userEvent.type(within(card).getByTestId('return-staff-note'), 'x')
    expect(within(card).getByTestId('return-reject')).toBeEnabled()
    await userEvent.click(within(card).getByTestId('return-approve'))
    expect(await screen.findByTestId('admin-returns-done')).toHaveTextContent('RT-ABCD2345: Approved.')
    expect(calls).toEqual(expect.arrayContaining(['list requested', 'approve']))
  })

  it('receive an approved return: damaged goods default to not restocked', async () => {
    const sent: unknown[] = []
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/returns', () => HttpResponse.json([adminReturn({ status: 'approved', reason: 'damaged' })])),
      http.post('/api/v1/admin/returns/RT-ABCD2345/receive', async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json(adminReturn({ status: 'received', refund_cents: 2434, restocked: false }))
      }),
    )
    renderApp('/admin/returns')
    const card = await screen.findByTestId('admin-return')
    expect(within(card).getByTestId('return-restock')).not.toBeChecked()
    await userEvent.click(within(card).getByTestId('return-receive'))
    expect(await screen.findByTestId('admin-returns-done')).toHaveTextContent('refunded $24.34')
    expect(sent).toEqual([{ restock: false }])
  })

  it('shows a conflict from the server', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/returns', () => HttpResponse.json([adminReturn()])),
      http.post('/api/v1/admin/returns/RT-ABCD2345/approve', () =>
        apiError(409, 'invalid_return_transition', "A return that is cancelled can't become approved."),
      ),
    )
    renderApp('/admin/returns')
    const card = await screen.findByTestId('admin-return')
    await userEvent.click(within(card).getByTestId('return-approve'))
    expect(await within(card).findByTestId('admin-return-error')).toHaveTextContent("can't become approved")
  })
})

describe('admin reviews (ADM-06)', () => {
  it('removes a review after confirming', async () => {
    const r: AdminReview = {
      id: 9,
      rating: 1,
      title: 'Spam',
      body: 'Buy my stuff',
      author: 'Sam K.',
      verified_purchase: true,
      created_at: '2026-09-21T10:00:00Z',
      updated_at: '2026-09-21T10:00:00Z',
      product_id: 1,
      product_name: 'Nonstick Frying Pan 10in',
      product_slug: 'nonstick-frying-pan-10in',
      author_email: 'sam@example.test',
    }
    let deleted = false
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/reviews', () =>
        HttpResponse.json({ items: deleted ? [] : [r], total: deleted ? 0 : 1, page: 1, page_size: 25 }),
      ),
      http.delete('/api/v1/admin/reviews/9', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/admin/reviews')
    const row = await screen.findByTestId('admin-review')
    expect(row).toHaveTextContent('sam@example.test')
    await userEvent.click(within(row).getByTestId('admin-review-delete'))
    await userEvent.click(within(row).getByTestId('admin-review-confirm'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Review removed.')
    expect(deleted).toBe(true)
  })
})
