import type { Address } from '../api/addresses'
import type { Order, Quote } from '../api/orders'
import { line } from './cartFixtures'

export const texas: Address = {
  id: 7,
  label: 'Home',
  recipient_name: 'Casey Customer',
  line1: '100 Congress Ave',
  line2: null,
  city: 'Austin',
  state: 'TX',
  postal_code: '78701',
  is_default: true,
}

export function quoteFor(overrides: Partial<Quote> = {}): Quote {
  return {
    lines: [line(1, 2)],
    item_count: 2,
    subtotal_cents: 4998,
    discount_cents: 0,
    coupon: null,
    tax_rate: 0.0825,
    tax_state: 'TX',
    tax_cents: 412,
    shipping_method: 'standard',
    shipping_cents: 599,
    total_cents: 6009,
    shipping_options: [
      { method: 'standard', cents: 599 },
      { method: 'express', cents: 1499 },
    ],
    can_place_order: true,
    blocking_reason: null,
    ...overrides,
  }
}

export function orderFor(overrides: Partial<Order> = {}): Order {
  return {
    order_number: 'HB-ABCD2345',
    status: 'pending_payment',
    placed_at: '2026-09-21T15:00:00Z',
    payment_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    delivered_at: null,
    shipping_method: 'standard',
    ship_to: { name: 'Casey Customer', line1: '100 Congress Ave', line2: null, city: 'Austin', state: 'TX', postal_code: '78701' },
    items: [
      { product_id: 1, sku: 'KIT-001', product_name: 'Nonstick Frying Pan 10in', unit_price_cents: 2499, quantity: 2, line_total_cents: 4998 },
    ],
    subtotal_cents: 4998,
    discount_cents: 0,
    coupon_code: null,
    tax_rate: 0.0825,
    tax_cents: 412,
    shipping_cents: 599,
    total_cents: 6009,
    history: [{ from_status: null, to_status: 'pending_payment', at: '2026-09-21T15:00:00Z', note: 'Order placed' }],
    payments: [],
    can_pay: true,
    can_cancel: true,
    return_window: { status: 'not_delivered', can_return: false, return_by: null, returnable: [] },
    ...overrides,
  }
}
