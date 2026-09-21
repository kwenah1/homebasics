import { http, HttpResponse } from 'msw'

import type { Cart, CartLine, GuestLine } from '../api/cart'
import { EMPTY_CART } from '../api/cart'
import { STORAGE_KEY } from '../cart/guestCart'

/** A tiny product table the fake cart API prices against. */
export const CATALOG: Record<number, { sku: string; slug: string; name: string; price: number; stock: number }> = {
  1: { sku: 'KIT-001', slug: 'nonstick-frying-pan-10in', name: 'Nonstick Frying Pan 10in', price: 2499, stock: 40 },
  6: { sku: 'KIT-006', slug: 'chef-s-knife-8in', name: "Chef's Knife 8in", price: 4999, stock: 18 },
  11: { sku: 'CLN-001', slug: 'all-purpose-cleaner-spray-32oz', name: 'All-Purpose Cleaner Spray 32oz', price: 499, stock: 150 },
  15: { sku: 'CLN-005', slug: 'glass-cleaner-26oz', name: 'Glass Cleaner 26oz', price: 399, stock: 1 },
}

export function line(productId: number, quantity: number, overrides: Partial<CartLine> = {}): CartLine {
  const p = CATALOG[productId]
  return {
    product_id: productId,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    category: { slug: 'kitchen', name: 'Kitchen' },
    unit_price_cents: p.price,
    quantity,
    line_total_cents: p.price * quantity,
    price_when_added_cents: p.price,
    price_change_cents: 0,
    stock_status: p.stock <= 5 ? 'low_stock' : 'in_stock',
    stock_left: p.stock <= 5 ? p.stock : null,
    max_order_qty: Math.min(10, p.stock),
    issue: null,
    available: null,
    ...overrides,
  }
}

export function cartOf(lines: CartLine[]): Cart {
  const subtotal = lines.filter((l) => !l.issue).reduce((n, l) => n + l.line_total_cents, 0)
  return {
    ...EMPTY_CART,
    items: lines,
    item_count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal_cents: subtotal,
    has_issues: lines.some((l) => l.issue),
    has_price_changes: lines.some((l) => l.price_change_cents),
    amount_to_free_shipping_cents: Math.max(0, 5000 - subtotal),
  }
}

/** Fake /cart/preview: prices guest lines against CATALOG, like the real endpoint. */
export function previewHandler(record?: GuestLine[][]) {
  return http.post('/api/v1/cart/preview', async ({ request }) => {
    const { items } = (await request.json()) as { items: GuestLine[] }
    record?.push(items)
    const known = items.filter((i) => CATALOG[i.product_id])
    const cart = cartOf(
      known.map((i) => {
        const current = CATALOG[i.product_id].price
        const seen = i.price_cents_seen ?? current
        return line(i.product_id, i.quantity, { price_when_added_cents: seen, price_change_cents: current - seen })
      }),
    )
    cart.unknown_product_ids = items.filter((i) => !CATALOG[i.product_id]).map((i) => i.product_id)
    return HttpResponse.json(cart)
  })
}

/**
 * A stateful fake of the account cart: GET /cart returns whatever the last merge produced,
 * like the real server. (A stateless GET returning an empty cart made the refetch after a
 * merge wipe the merged items - the fake, not the app, was wrong.)
 */
export function accountCartServer(mergeResult: { cart: Cart; report: MergeReportLike } | (() => Response | { cart: Cart; report: MergeReportLike })) {
  let current: Cart = EMPTY_CART
  const merges: unknown[] = []
  const handlers = [
    http.get('/api/v1/cart', () => HttpResponse.json(current)),
    http.post('/api/v1/cart/merge', async ({ request }) => {
      merges.push(await request.json())
      const result = typeof mergeResult === 'function' ? mergeResult() : mergeResult
      if (result instanceof Response) return result
      current = result.cart
      return HttpResponse.json(result)
    }),
  ]
  return { handlers, merges }
}

type MergeReportLike = {
  capped: { product_id: number; requested: number; kept: number }[]
  skipped: { product_id: number; reason: 'unavailable' | 'out_of_stock' }[]
}

export function seedGuestCart(lines: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
}

export function storedGuestCart(): GuestLine[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
}
