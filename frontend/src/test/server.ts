import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { TokenResponse, User } from '../api/auth'
import type { Health } from '../api/health'

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

export const apiError = (status: number, code: string, message = code, extra = {}) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status })

// Default: API healthy, visitor anonymous. Override per test with server.use(...).
export const handlers = [
  http.get('/api/v1/health', () => HttpResponse.json(healthyResponse)),
  http.post('/api/v1/auth/refresh', () => apiError(401, 'invalid_refresh_token')),
  http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),
]

/** Handlers for a visitor who already has a valid session cookie. */
export const signedIn = (user: User = casey) => [
  http.post('/api/v1/auth/refresh', () => HttpResponse.json(tokenFor(user))),
  http.get('/api/v1/me', () => HttpResponse.json(user)),
]

export const server = setupServer(...handlers)
