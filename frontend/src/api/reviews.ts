import { apiFetch } from './client'

export interface Review {
  id: number
  rating: number
  title: string | null
  body: string | null
  author: string
  verified_purchase: boolean
  created_at: string
  updated_at: string
}

export interface ReviewPage {
  items: Review[]
  total: number
  page: number
  page_size: number
  rating_avg: number | null
  rating_count: number
  distribution: Record<string, number>
}

export interface MyReview {
  can_review: boolean
  reason: 'not_purchased' | 'already_reviewed' | null
  review: Review | null
}

export interface ReviewInput {
  rating: number
  title?: string
  body?: string
}

const base = (slug: string) => `/products/${encodeURIComponent(slug)}/reviews`

export const reviewApi = {
  list: (slug: string, page = 1, pageSize = 5) =>
    apiFetch<ReviewPage>(`${base(slug)}?page=${page}&page_size=${pageSize}`),
  mine: (slug: string) => apiFetch<MyReview>(`${base(slug)}/mine`, { auth: true }),
  create: (slug: string, body: ReviewInput) =>
    apiFetch<Review>(base(slug), { method: 'POST', json: body, auth: true }),
  update: (slug: string, body: ReviewInput) =>
    apiFetch<Review>(`${base(slug)}/mine`, { method: 'PATCH', json: body, auth: true }),
  remove: (slug: string) => apiFetch<void>(`${base(slug)}/mine`, { method: 'DELETE', auth: true }),
}
