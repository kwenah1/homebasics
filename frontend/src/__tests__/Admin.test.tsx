import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { User } from '../api/auth'
import type { AdminOrder, AdminProduct } from '../api/admin'
import { orderFor } from '../test/orderFixtures'
import { renderApp } from '../test/render'
import { apiError, casey, server, signedIn } from '../test/server'

const ada: User = { ...casey, id: 1, email: 'admin@homebasics.test', first_name: 'Ada', role: 'admin' }

const whisk: AdminProduct = {
  id: 70,
  sku: 'TST-001',
  slug: 'test-whisk',
  name: 'Test Whisk',
  description: 'Balloon whisk.',
  price_cents: 899,
  stock_qty: 5,
  is_archived: false,
  category_id: 1,
  category_name: 'Kitchen',
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
}

const ledger = {
  product_id: 70,
  stock_qty: 5,
  ledger_total: 5,
  movements: [{ id: 1, delta: 5, reason: 'initial', order_number: null, actor_email: 'admin@homebasics.test', note: null, created_at: '2026-09-21T10:00:00Z' }],
}

describe('admin access (ADM-04)', () => {
  it('customers see a staff-only page and no Admin link', async () => {
    server.use(...signedIn())
    renderApp('/admin')
    expect(await screen.findByTestId('forbidden')).toHaveTextContent('Staff only')
    expect(screen.queryByTestId('nav-admin')).not.toBeInTheDocument()
  })

  it('anonymous visitors are sent to sign in', async () => {
    renderApp('/admin/orders')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('admins get the back office and the header link', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/summary', () =>
        HttpResponse.json({
          orders_by_status: { pending_payment: 1, paid: 2, processing: 1, shipped: 0, delivered: 0, cancelled: 0, expired: 0, refunded: 0 },
          awaiting_fulfilment: 3,
          low_stock: [{ id: 15, sku: 'CLN-005', name: 'Glass Cleaner 26oz', stock_qty: 1 }],
        }),
      ),
    )
    renderApp('/admin')
    expect(await screen.findByTestId('awaiting-fulfilment')).toHaveTextContent('3')
    expect(screen.getByTestId('nav-admin')).toBeInTheDocument()
    expect(within(screen.getByTestId('low-stock')).getByText('CLN-005')).toBeInTheDocument()
  })
})

describe('admin products (ADM-01, ADM-02)', () => {
  it('create: server field errors are shown next to the field', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/categories', () =>
        HttpResponse.json([{ id: 1, name: 'Kitchen', slug: 'kitchen', description: null, active_products: 10, archived_products: 1 }]),
      ),
      http.post('/api/v1/admin/products', () =>
        apiError(409, 'sku_taken', 'That SKU is already used.', { fields: { sku: 'Already used.' } }),
      ),
    )
    renderApp('/admin/products/new')
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('admin-product-sku'), 'KIT-001')
    await user.type(screen.getByTestId('admin-product-name'), 'Another Pan')
    await user.type(screen.getByTestId('admin-product-price'), '12.50')
    await user.click(screen.getByTestId('admin-product-save'))
    expect(await screen.findByTestId('admin-error-sku')).toHaveTextContent('Already used.')
  })

  it('create sends the price in cents', async () => {
    let body: unknown
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/categories', () =>
        HttpResponse.json([{ id: 1, name: 'Kitchen', slug: 'kitchen', description: null, active_products: 10, archived_products: 1 }]),
      ),
      http.post('/api/v1/admin/products', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(whisk, { status: 201 })
      }),
      http.get('/api/v1/admin/products/70', () => HttpResponse.json(whisk)),
      http.get('/api/v1/admin/products/70/stock-movements', () => HttpResponse.json(ledger)),
    )
    renderApp('/admin/products/new')
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('admin-product-sku'), 'TST-001')
    await user.type(screen.getByTestId('admin-product-name'), 'Test Whisk')
    await user.type(screen.getByTestId('admin-product-price'), '8.99')
    await user.clear(screen.getByTestId('admin-product-stock-input'))
    await user.type(screen.getByTestId('admin-product-stock-input'), '5')
    await user.click(screen.getByTestId('admin-product-save'))

    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Product created and on sale.')
    expect(body).toMatchObject({ sku: 'TST-001', price_cents: 899, initial_stock: 5, category_id: 1 })
  })

  it.each([
    ['damaged', '3', -3],
    ['restock', '10', 10],
  ] as const)('a %s adjustment sends delta %i', async (reason, amount, delta) => {
    let body: unknown
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/products/70', () => HttpResponse.json(whisk)),
      http.get('/api/v1/admin/products/70/stock-movements', () => HttpResponse.json(ledger)),
      http.post('/api/v1/admin/products/70/stock-adjustments', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...whisk, stock_qty: 5 + delta })
      }),
    )
    renderApp('/admin/products/70')
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByTestId('admin-adjust-reason'), reason)
    await user.type(screen.getByTestId('admin-adjust-amount'), amount)
    await user.click(screen.getByTestId('admin-adjust-submit'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Stock updated.')
    expect(body).toMatchObject({ delta, reason })
  })

  it('removing more than is in stock shows the refusal', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/products/70', () => HttpResponse.json(whisk)),
      http.get('/api/v1/admin/products/70/stock-movements', () => HttpResponse.json(ledger)),
      http.post('/api/v1/admin/products/70/stock-adjustments', () =>
        apiError(409, 'insufficient_stock', "Only 5 in stock; can't remove 9.", { available: 5 }),
      ),
    )
    renderApp('/admin/products/70')
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByTestId('admin-adjust-reason'), 'damaged')
    await user.type(screen.getByTestId('admin-adjust-amount'), '9')
    await user.click(screen.getByTestId('admin-adjust-submit'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent("Only 5 in stock; can't remove 9.")
  })

  it('shows the ledger reconciliation check', async () => {
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/products/70', () => HttpResponse.json(whisk)),
      http.get('/api/v1/admin/products/70/stock-movements', () => HttpResponse.json(ledger)),
    )
    renderApp('/admin/products/70')
    expect(await screen.findByTestId('admin-ledger-check')).toHaveTextContent('Ledger total 5 = stock ✓')
  })
})

describe('admin orders (ADM-03)', () => {
  const paid: AdminOrder = {
    ...orderFor({ status: 'paid', can_pay: false }),
    customer_email: 'customer@homebasics.test',
    customer_name: 'Casey Customer',
    next_statuses: ['processing', 'cancelled'],
  }

  it('offers exactly the next steps the server allows, and applies one with a note', async () => {
    let body: unknown
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/orders/HB-ABCD2345', () => HttpResponse.json(paid)),
      http.post('/api/v1/admin/orders/HB-ABCD2345/status', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...paid, status: 'processing', next_statuses: ['shipped', 'cancelled'] })
      }),
    )
    renderApp('/admin/orders/HB-ABCD2345')
    expect(await screen.findByTestId('admin-order-action-processing')).toHaveTextContent('Start processing')
    expect(screen.getByTestId('admin-order-action-cancelled')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-order-action-shipped')).not.toBeInTheDocument()

    await userEvent.type(screen.getByTestId('admin-order-note'), 'Packing now')
    await userEvent.click(screen.getByTestId('admin-order-action-processing'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Order is now processing.')
    expect(body).toEqual({ to: 'processing', note: 'Packing now' })
    await waitFor(() => expect(screen.getByTestId('admin-order-action-shipped')).toBeInTheDocument())
  })

  it('refund uses the refund endpoint', async () => {
    let called = false
    const delivered = { ...paid, status: 'delivered' as const, next_statuses: ['refunded' as const] }
    server.use(
      ...signedIn(ada),
      http.get('/api/v1/admin/orders/HB-ABCD2345', () => HttpResponse.json(delivered)),
      http.post('/api/v1/admin/orders/HB-ABCD2345/refund', () => {
        called = true
        return HttpResponse.json({ ...delivered, status: 'refunded', next_statuses: [] })
      }),
    )
    renderApp('/admin/orders/HB-ABCD2345')
    await userEvent.click(await screen.findByTestId('admin-order-action-refunded'))
    expect(await screen.findByTestId('admin-notice')).toHaveTextContent('Order is now refunded.')
    expect(called).toBe(true)
  })
})
