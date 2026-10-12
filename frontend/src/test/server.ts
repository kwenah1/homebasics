import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { TokenResponse, User } from '../api/auth'
import { EMPTY_CART } from '../api/cart'
import type { Health } from '../api/health'
import { categories, page } from './catalogFixtures'

export const healthyResponse: Health = {
  status: 'ok',
  database: 'ok',
  version: '0.1.0',
  environment: 'test',
}

export const casey: User = {
  id: 2,
  email: 'customer@homebasics.test',
  first_name: 'Casey',
  last_name: 'Customer',
  role: 'customer',
  created_at: '2026-09-21T00:00:00Z',
}

export function tokenFor(user: User = casey, token = 'access-1'): TokenResponse {
  return { access_token: token, token_type: 'bearer', expires_in: 900, user }
}

export const EMPTY_REVIEWS = {
  items: [],
  total: 0,
  page: 1,
  page_size: 5,
  rating_avg: null,
  rating_count: 0,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
}

export const apiError = (status: number, code: string, message = code, extra = {}) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status })

// Default: API healthy, visitor anonymous, catalog empty. Override per test with server.use(...).
export const handlers = [
  http.get('/api/v1/health', () => HttpResponse.json(healthyResponse)),
  http.get('/api/v1/categories', () => HttpResponse.json(categories)),
  http.get('/api/v1/products', () => HttpResponse.json(page([]))),
  http.get('/api/v1/cart', () => HttpResponse.json(EMPTY_CART)),
  http.post('/api/v1/auth/refresh', () => apiError(401, 'invalid_refresh_token')),
  http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),
  // Phase 2 (M8): empty until a test says otherwise.
  http.get('/api/v1/products/:slug/reviews', () => HttpResponse.json(EMPTY_REVIEWS)),
  http.get('/api/v1/products/:slug/reviews/mine', () =>
    HttpResponse.json({ can_review: false, reason: 'not_purchased', review: null }),
  ),
  http.get('/api/v1/me/wishlist', () => HttpResponse.json({ items: [], count: 0, limit: 50 })),
  http.get('/api/v1/orders/:number/returns', () => HttpResponse.json([])),
]

/** Handlers for a visitor who already has a valid session cookie. */
export const signedIn = (user: User = casey) => [
  http.post('/api/v1/auth/refresh', () => HttpResponse.json(tokenFor(user))),
  http.get('/api/v1/me', () => HttpResponse.json(user)),
]

export const server = setupServer(...handlers)
