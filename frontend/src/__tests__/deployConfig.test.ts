/**
 * The built app is served by Vercel in production and by `vite preview` in the nightly ZAP
 * scan. Two header lists are two chances to drift, so this pins them together: if someone
 * tightens the CSP in one place, this fails until the other matches (NFR-SEC-04).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SECURITY_HEADERS } from '../../vite.config'

const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))

describe('deployment config', () => {
  it('Vercel sends exactly the headers vite preview does', () => {
    const rule = vercel.headers.find((h: { source: string }) => h.source === '/(.*)')
    const served = Object.fromEntries(rule.headers.map((h: { key: string; value: string }) => [h.key, h.value]))
    expect(served).toEqual(SECURITY_HEADERS)
  })

  it('proxies /api to the API host before the SPA fallback', () => {
    const [api, spa] = vercel.rewrites
    expect(api.source).toBe('/api/:path*')
    expect(api.destination).toMatch(/^https:\/\/[^/]+\/api\/:path\*$/)
    // Same-origin /api is what keeps the httpOnly refresh cookie working.
    expect(api.destination).not.toContain('localhost')
    expect(spa).toEqual({ source: '/(.*)', destination: '/index.html' })
  })
})
