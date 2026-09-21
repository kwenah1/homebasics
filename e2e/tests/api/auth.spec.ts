import { expect, test } from '@playwright/test'

import { uniqueUser } from '../../support/api'

// Runs in the "api" project: baseURL is the API itself; each test gets a fresh cookie jar.

async function register(request: import('@playwright/test').APIRequestContext) {
  const user = uniqueUser()
  const response = await request.post('/api/v1/auth/register', {
    data: {
      email: user.email,
      password: user.password,
      first_name: user.firstName,
      last_name: user.lastName,
    },
  })
  expect(response.status()).toBe(201)
  return { user, body: await response.json() }
}

test.describe('API: auth contract @api', () => {
  test('register returns a bearer token that works on /me', async ({ request }) => {
    const { user, body } = await register(request)
    expect(body).toMatchObject({ token_type: 'bearer', expires_in: 900 })

    const me = await request.get('/api/v1/me', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    })
    expect(me.status()).toBe(200)
    expect(await me.json()).toMatchObject({ email: user.email, role: 'customer' })
  })

  test('Set-Cookie flags on login', async ({ request }) => {
    const { user } = await register(request)
    const response = await request.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password },
    })
    const setCookie = response.headers()['set-cookie'].toLowerCase()
    for (const flag of ['hb_refresh=', 'httponly', 'samesite=strict', 'path=/api/v1/auth']) {
      expect(setCookie).toContain(flag)
    }
  })

  test('error bodies share one shape', async ({ request }) => {
    const responses = await Promise.all([
      request.get('/api/v1/me'),
      request.post('/api/v1/auth/login', { data: { email: 'x@e2e.test', password: 'Nope1234' } }),
      request.post('/api/v1/auth/register', { data: {} }),
      request.get('/api/v1/nope'),
    ])
    const codes = []
    for (const r of responses) {
      const body = await r.json()
      expect(Object.keys(body)).toEqual(['error'])
      expect(typeof body.error.message).toBe('string')
      codes.push([r.status(), body.error.code])
    }
    expect(codes).toEqual([
      [401, 'not_authenticated'],
      [401, 'invalid_credentials'],
      [422, 'validation_error'],
      [404, 'not_found'],
    ])
  })

  test('mass assignment: role cannot be set at registration', async ({ request }) => {
    const user = uniqueUser()
    const response = await request.post('/api/v1/auth/register', {
      data: { email: user.email, password: user.password, first_name: 'A', last_name: 'B', role: 'admin' },
    })
    expect(response.status()).toBe(422)
  })

  test('IDOR: cannot read or change another customer address', async ({ playwright }) => {
    const baseURL = test.info().project.use.baseURL
    const alice = await playwright.request.newContext({ baseURL })
    const mallory = await playwright.request.newContext({ baseURL })
    const auth = async (ctx: typeof alice) =>
      ({ Authorization: `Bearer ${(await register(ctx)).body.access_token}` })

    const aliceAuth = await auth(alice)
    const created = await alice.post('/api/v1/me/addresses', {
      headers: aliceAuth,
      data: { recipient_name: 'Alice', line1: '1 Main', city: 'Austin', state: 'TX', postal_code: '78701' },
    })
    expect(created.status(), await created.text()).toBe(201)
    const { id } = await created.json()

    const malloryAuth = await auth(mallory)
    const attack = await mallory.patch(`/api/v1/me/addresses/${id}`, {
      headers: malloryAuth,
      data: { city: 'Pwned' },
    })
    expect(attack.status()).toBe(404)

    const list = await alice.get('/api/v1/me/addresses', { headers: aliceAuth })
    expect(list.status(), await list.text()).toBe(200)
    const [aliceView] = await list.json()
    expect(aliceView.city).toBe('Austin')
    await Promise.all([alice.dispose(), mallory.dispose()])
  })
})
