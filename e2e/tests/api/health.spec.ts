import { expect, test } from '@playwright/test'

test.describe('API: health & test support @api', () => {
  test('GET /health returns ok with database up', async ({ request }) => {
    const response = await request.get('/api/v1/health')

    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' })
    expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f]{32}$/)
  })

  test('X-Request-ID is echoed for tracing', async ({ request }) => {
    const response = await request.get('/api/v1/health', {
      headers: { 'X-Request-ID': 'pw-trace-001' },
    })
    expect(response.headers()['x-request-id']).toBe('pw-trace-001')
  })

  test('OpenAPI spec is published', async ({ request }) => {
    const spec = await (await request.get('/api/v1/openapi.json')).json()
    expect(spec.openapi).toMatch(/^3\./)
    expect(Object.keys(spec.paths)).toContain('/api/v1/health')
  })
})
