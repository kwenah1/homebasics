import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { apiFetch } from './client'

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'
export type ProductSort = 'name' | 'price_asc' | 'price_desc' | 'newest' | 'rating'

export interface Category {
  id: number
  slug: string
  name: string
  description: string | null
  product_count: number
}

export interface ProductSummary {
  id: number
  sku: string
  slug: string
  name: string
  price_cents: number
  category: { slug: string; name: string }
  stock_status: StockStatus
  stock_left: number | null
  rating_avg: number | null
  rating_count: number
}

export interface ProductDetail extends ProductSummary {
  description: string
  images: { url: string; alt_text: string }[]
  max_order_qty: number
}

export interface ProductPage {
  items: ProductSummary[]
  total: number
  page: number
  page_size: number
  pages: number
}

/** API query parameters (money in cents). */
export interface ProductQuery {
  category?: string
  q?: string
  min_price_cents?: number
  max_price_cents?: number
  in_stock?: boolean
  sort?: ProductSort
  page?: number
  page_size?: number
}

export function toApiParams(query: ProductQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '' || value === false) continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
    staleTime: 5 * 60_000,
  })
}

export function useProducts(query: ProductQuery) {
  const qs = toApiParams(query)
  return useQuery({
    queryKey: ['products', qs],
    queryFn: () => apiFetch<ProductPage>(`/products${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData, // keep the old grid while the next page loads
  })
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => apiFetch<ProductDetail>(`/products/${encodeURIComponent(slug)}`),
  })
}
