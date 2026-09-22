import { apiFetch } from './client'
import type { StockStatus } from './catalog'

export type LineIssue = 'unavailable' | 'out_of_stock' | 'insufficient_stock'

export interface CartLine {
  product_id: number
  sku: string
  slug: string
  name: string
  category: { slug: string; name: string }
  unit_price_cents: number
  quantity: number
  line_total_cents: number
  price_when_added_cents: number
  price_change_cents: number
  stock_status: StockStatus
  stock_left: number | null
  max_order_qty: number
  issue: LineIssue | null
  available: number | null
}

export interface Cart {
  items: CartLine[]
  item_count: number
  subtotal_cents: number
  has_issues: boolean
  has_price_changes: boolean
  free_shipping_threshold_cents: number
  amount_to_free_shipping_cents: number
  unknown_product_ids: number[]
}

export interface GuestLine {
  product_id: number
  quantity: number
  price_cents_seen?: number
}

export interface MergeReport {
  capped: { product_id: number; requested: number; kept: number }[]
  skipped: { product_id: number; reason: 'unavailable' | 'out_of_stock' }[]
}

export const cartApi = {
  get: () => apiFetch<Cart>('/cart', { auth: true }),
  add: (product_id: number, quantity: number) =>
    apiFetch<Cart>('/cart/items', { method: 'POST', json: { product_id, quantity }, auth: true }),
  setQuantity: (product_id: number, quantity: number) =>
    apiFetch<Cart>(`/cart/items/${product_id}`, { method: 'PATCH', json: { quantity }, auth: true }),
  remove: (product_id: number) =>
    apiFetch<Cart>(`/cart/items/${product_id}`, { method: 'DELETE', auth: true }),
  clear: () => apiFetch<void>('/cart', { method: 'DELETE', auth: true }),
  acknowledgePrices: () =>
    apiFetch<Cart>('/cart/acknowledge-prices', { method: 'POST', auth: true }),
  merge: (items: GuestLine[]) =>
    apiFetch<{ cart: Cart; report: MergeReport }>('/cart/merge', {
      method: 'POST',
      json: { items },
      auth: true,
    }),
  preview: (items: GuestLine[]) =>
    apiFetch<Cart>('/cart/preview', { method: 'POST', json: { items } }),
}

export const EMPTY_CART: Cart = {
  items: [],
  item_count: 0,
  subtotal_cents: 0,
  has_issues: false,
  has_price_changes: false,
  free_shipping_threshold_cents: 5000,
  amount_to_free_shipping_cents: 5000,
  unknown_product_ids: [],
}
