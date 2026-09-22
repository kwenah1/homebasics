import { useQuery } from '@tanstack/react-query'

import type { Cart } from './cart'
import type { ProductSummary } from './catalog'
import { apiFetch } from './client'

export interface Wishlist {
  items: { product: ProductSummary; added_at: string; available: boolean }[]
  count: number
  limit: number
}

export const wishlistApi = {
  get: () => apiFetch<Wishlist>('/me/wishlist', { auth: true }),
  add: (productId: number) => apiFetch<Wishlist>(`/me/wishlist/${productId}`, { method: 'PUT', auth: true }),
  remove: (productId: number) => apiFetch<void>(`/me/wishlist/${productId}`, { method: 'DELETE', auth: true }),
  moveToCart: (productId: number) =>
    apiFetch<Cart>(`/me/wishlist/${productId}/move-to-cart`, { method: 'POST', auth: true }),
}

export function useWishlist(enabled: boolean) {
  return useQuery({ queryKey: ['wishlist'], queryFn: wishlistApi.get, enabled })
}
