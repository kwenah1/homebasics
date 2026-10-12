import { useQuery } from '@tanstack/react-query'

import { apiFetch } from './client'

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'cancelled' | 'received'
export type ReturnReason = 'damaged' | 'wrong_item' | 'not_as_described' | 'no_longer_needed' | 'other'

export interface ReturnRequest {
  return_number: string
  order_number: string
  status: ReturnStatus
  reason: ReturnReason
  note: string | null
  staff_note: string | null
  items: { product_id: number; sku: string; product_name: string; unit_price_cents: number; quantity: number }[]
  value_cents: number
  refund_cents: number | null
  restocked: boolean | null
  created_at: string
  updated_at: string
  can_cancel: boolean
}

export interface AdminReturn extends ReturnRequest {
  customer_email: string
  customer_name: string
}

export const REASON_LABEL: Record<ReturnReason, string> = {
  damaged: 'Arrived damaged',
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  no_longer_needed: 'No longer needed',
  other: 'Other',
}

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved - send it back',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  received: 'Received - refunded',
}

export const returnApi = {
  create: (
    orderNumber: string,
    body: { items: { product_id: number; quantity: number }[]; reason: ReturnReason; note?: string },
  ) => apiFetch<ReturnRequest>(`/orders/${orderNumber}/returns`, { method: 'POST', json: body, auth: true }),
  forOrder: (orderNumber: string) => apiFetch<ReturnRequest[]>(`/orders/${orderNumber}/returns`, { auth: true }),
  cancel: (returnNumber: string) =>
    apiFetch<ReturnRequest>(`/returns/${returnNumber}/cancel`, { method: 'POST', auth: true }),
}

export function useOrderReturns(orderNumber: string, enabled: boolean) {
  return useQuery({
    queryKey: ['returns', orderNumber],
    queryFn: () => returnApi.forOrder(orderNumber),
    enabled,
  })
}
