import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApiError, apiFetch, getAccessToken, setAccessToken } from '../api/client'
import { apiError, casey, server, tokenFor } from '../test/server'

describe('apiFetch auth handling', () => {
  beforeEach(() => setAccessToken('old-token'))

  it('sends the bearer token when auth is on', async () => {
    let seen: string | null = null
    server.use(
      http.get('/api/v1/me', ({ request }) => {
        seen = request.headers.get('Authorization')
        return HttpResponse.json(casey)
      }),
    )
    await apiFetch('/me', { auth: true })
    expect(seen).toBe('Bearer old-token')
  })

  it('does not send the token when auth is off', async () => {
    let seen: string | null = 'unset'
    server.use(
      http.get('/api/v1/states', ({ request }) => {
        seen = request.headers.get('Authorization')
        return HttpResponse.json([])
      }),
    )
    await apiFetch('/states')
    expect(seen).toBeNull()
  })

  it('refreshes once on token_expired and retries with the new token', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get('/api/v1/me', ({ request }) => {
        const auth = request.headers.get('Authorization')
        seen.push(auth)
        return auth === 'Bearer new-token'
          ? HttpResponse.json(casey)
          : apiError(401, 'token_expired')
      }),
      http.post('/api/v1/auth/refresh', () => HttpResponse.json(tokenFor(casey, 'new-token'))),
    )

    await expect(apiFetch('/me', { auth: true })).resolves.toEqual(casey)
    expect(seen).toEqual(['Bearer old-token', 'Bearer new-token'])
    expect(getAccessToken()).toBe('new-token')
  })

  it('shares one refresh between parallel requests (rotation-safe)', async () => {
    let refreshes = 0
    server.use(
      http.get('/api/v1/me', ({ request }) =>
        request.headers.get('Authorization') === 'Bearer new-token'
          ? HttpResponse.json(casey)
          : apiError(401, 'token_expired'),
      ),
      http.post('/api/v1/auth/refresh', async () => {
        refreshes++
        await new Promise((r) => setTimeout(r, 20))
        return HttpResponse.json(tokenFor(casey, 'new-token'))
      }),
    )
    await Promise.all([1, 2, 3].map(() => apiFetch('/me', { auth: true })))
    expect(refreshes).toBe(1)
  })

  it('does not refresh for other 401 codes', async () => {
    let refreshes = 0
    server.use(
      http.get('/api/v1/me', () => apiError(401, 'invalid_token')),
      http.post('/api/v1/auth/refresh', () => {
        refreshes++
        return HttpResponse.json(tokenFor())
      }),
    )
    await expect(apiFetch('/me', { auth: true })).rejects.toBeInstanceOf(ApiError)
    expect(refreshes).toBe(0)
  })

  it('surfaces error code, message and fields', async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        apiError(409, 'email_taken', 'Already exists', { fields: { email: 'Taken' } }),
      ),
    )
    const error = (await apiFetch('/auth/register', { method: 'POST', json: {} }).catch(
      (e: unknown) => e,
    )) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('email_taken')
    expect(error.message).toBe('Already exists')
    expect(error.fields).toEqual({ email: 'Taken' })
  })
})
