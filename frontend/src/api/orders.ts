import { useQuery } from '@tanstack/react-query'

import type { CartLine } from './cart'
import { apiFetch } from './client'

export type ShippingMethod = 'standard' | 'express'
export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'expired'
  | 'refunded'

export interface Quote {
  lines: CartLine[]
  item_count: number
  subtotal_cents: number
  discount_cents: number
  tax_rate: number
  tax_state: string
  tax_cents: number
  shipping_method: ShippingMethod
  shipping_cents: number
  total_cents: number
  shipping_options: { method: ShippingMethod; cents: number }[]
  can_place_order: boolean
  blocking_reason: string | null
}

export interface Order {
  order_number: string
  status: OrderStatus
  placed_at: string
  payment_expires_at: string | null
  shipping_method: ShippingMethod
  ship_to: { name: string; line1: string; line2: string | null; city: string; state: string; postal_code: string }
  items: {
    product_id: number
    sku: string
    product_name: string
    unit_price_cents: number
    quantity: number
    line_total_cents: number
  }[]
  subtotal_cents: number
  discount_cents: number
  tax_rate: number
  tax_cents: number
  shipping_cents: number
  total_cents: number
  history: { from_status: OrderStatus | null; to_status: OrderStatus; at: string; note: string | null }[]
  payments: {
    status: 'succeeded' | 'declined' | 'failed' | 'refunded'
    amount_cents: number
    card_last4: string
    failure_reason: string | null
    at: string
  }[]
  can_pay: boolean
  can_cancel: boolean
}

export interface OrderSummary {
  order_number: string
  status: OrderStatus
  placed_at: string
  item_count: number
  total_cents: number
}

export interface CardDetails {
  card_number: string
  exp_month: number
  exp_year: number
  cvc: string
  name_on_card: string
}

export const orderApi = {
  quote: (address_id: number, shipping_method: ShippingMethod) =>
    apiFetch<Quote>('/checkout/quote', { method: 'POST', json: { address_id, shipping_method }, auth: true }),
  place: (
    body: { address_id: number; shipping_method: ShippingMethod; expected_total_cents: number },
    idempotencyKey: string,
  ) =>
    apiFetch<Order>('/checkout/place-order', {
      method: 'POST',
      json: body,
      auth: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  pay: (orderNumber: string, card: CardDetails, idempotencyKey: string) =>
    apiFetch<Order>(`/orders/${orderNumber}/pay`, {
      method: 'POST',
      json: card,
      auth: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  cancel: (orderNumber: string) =>
    apiFetch<Order>(`/orders/${orderNumber}/cancel`, { method: 'POST', auth: true }),
  get: (orderNumber: string) => apiFetch<Order>(`/orders/${orderNumber}`, { auth: true }),
  list: (page = 1) =>
    apiFetch<{ items: OrderSummary[]; total: number; page: number; page_size: number }>(
      `/orders?page=${page}`,
      { auth: true },
    ),
}

export function useOrder(orderNumber: string) {
  return useQuery({ queryKey: ['order', orderNumber], queryFn: () => orderApi.get(orderNumber) })
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  expired: 'Expired',
  refunded: 'Refunded',
}
