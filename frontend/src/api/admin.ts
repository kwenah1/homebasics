import { apiFetch } from './client'
import type { Order, OrderStatus } from './orders'

export interface AdminProduct {
  id: number
  sku: string
  slug: string
  name: string
  description: string
  price_cents: number
  stock_qty: number
  is_archived: boolean
  category_id: number
  category_name: string
  created_at: string
  updated_at: string
}

export interface AdminCategory {
  id: number
  name: string
  slug: string
  description: string | null
  active_products: number
  archived_products: number
}

export interface Movement {
  id: number
  delta: number
  reason: string
  order_number: string | null
  actor_email: string | null
  note: string | null
  created_at: string
}

export interface StockLedger {
  product_id: number
  stock_qty: number
  ledger_total: number
  movements: Movement[]
}

export interface AdminOrderSummary {
  order_number: string
  status: OrderStatus
  placed_at: string
  customer_email: string
  item_count: number
  total_cents: number
}

export interface AdminOrder extends Order {
  customer_email: string
  customer_name: string
  next_statuses: OrderStatus[]
}

export interface AdminSummary {
  orders_by_status: Record<OrderStatus, number>
  awaiting_fulfilment: number
  low_stock: { id: number; sku: string; name: string; stock_qty: number }[]
}

export type AdjustReason = 'restock' | 'adjustment' | 'damaged'

type Page<T> = { items: T[]; total: number; page: number; page_size: number }

const opts = { auth: true } as const
const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ''
}

export const adminApi = {
  summary: () => apiFetch<AdminSummary>('/admin/summary', opts),

  products: (params: { q?: string; archived?: string; category_id?: number; page?: number }) =>
    apiFetch<Page<AdminProduct>>(`/admin/products${qs(params)}`, opts),
  product: (id: number) => apiFetch<AdminProduct>(`/admin/products/${id}`, opts),
  createProduct: (body: {
    category_id: number
    sku: string
    name: string
    description: string
    price_cents: number
    initial_stock: number
  }) => apiFetch<AdminProduct>('/admin/products', { ...opts, method: 'POST', json: body }),
  updateProduct: (id: number, body: Partial<Pick<AdminProduct, 'name' | 'description' | 'price_cents' | 'category_id'>>) =>
    apiFetch<AdminProduct>(`/admin/products/${id}`, { ...opts, method: 'PATCH', json: body }),
  setArchived: (id: number, archived: boolean) =>
    apiFetch<AdminProduct>(`/admin/products/${id}/${archived ? 'archive' : 'unarchive'}`, { ...opts, method: 'POST' }),
  adjustStock: (id: number, body: { delta: number; reason: AdjustReason; note?: string }) =>
    apiFetch<AdminProduct>(`/admin/products/${id}/stock-adjustments`, { ...opts, method: 'POST', json: body }),
  ledger: (id: number) => apiFetch<StockLedger>(`/admin/products/${id}/stock-movements`, opts),

  categories: () => apiFetch<AdminCategory[]>('/admin/categories', opts),
  createCategory: (name: string, description?: string) =>
    apiFetch<AdminCategory>('/admin/categories', { ...opts, method: 'POST', json: { name, description } }),
  renameCategory: (id: number, name: string) =>
    apiFetch<AdminCategory>(`/admin/categories/${id}`, { ...opts, method: 'PATCH', json: { name } }),
  deleteCategory: (id: number) => apiFetch<void>(`/admin/categories/${id}`, { ...opts, method: 'DELETE' }),

  orders: (params: { status?: string; q?: string; page?: number }) =>
    apiFetch<Page<AdminOrderSummary>>(`/admin/orders${qs(params)}`, opts),
  order: (number: string) => apiFetch<AdminOrder>(`/admin/orders/${number}`, opts),
  setStatus: (number: string, to: OrderStatus, note?: string) =>
    apiFetch<AdminOrder>(`/admin/orders/${number}/status`, { ...opts, method: 'POST', json: { to, note } }),
  refund: (number: string, note?: string) =>
    apiFetch<AdminOrder>(`/admin/orders/${number}/refund`, { ...opts, method: 'POST', json: { note } }),
}
