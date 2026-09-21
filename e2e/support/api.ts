import type { APIRequestContext } from '@playwright/test'

export const API_URL = process.env.API_URL ?? 'http://localhost:8010'

export interface TestUser {
  email: string
  password: string
  firstName: string
  lastName: string
}

let counter = 0

/** Unique per call (and per worker) - E2E tests never share or reset accounts. */
export function uniqueUser(overrides: Partial<TestUser> = {}): TestUser {
  counter += 1
  const tag = `${Date.now().toString(36)}${process.pid}${counter}`
  return {
    email: `pw.${tag}@e2e.test`,
    password: 'Sparkle123',
    firstName: 'Pat',
    lastName: `Tester${counter}`,
    ...overrides,
  }
}

/** Thin client for the API and the test-only endpoints (/api/v1/test/*). */
export class Api {
  constructor(private readonly request: APIRequestContext) {}

  async register(user: TestUser) {
    const response = await this.request.post(`${API_URL}/api/v1/auth/register`, {
      data: {
        email: user.email,
        password: user.password,
        first_name: user.firstName,
        last_name: user.lastName,
      },
    })
    if (response.status() !== 201) throw new Error(`register failed: ${await response.text()}`)
    return response.json()
  }

  async latestEmail(to: string) {
    const response = await this.request.get(`${API_URL}/api/v1/test/emails`, {
      params: { to, limit: 1 },
    })
    const [email] = (await response.json()) as { subject: string; body: string }[]
    return email
  }

  async resetLinkFor(to: string): Promise<string> {
    const email = await this.latestEmail(to)
    const match = email?.body.match(/https?:\/\/\S+\/reset-password\?token=[\w-]+/)
    if (!match) throw new Error(`no reset link emailed to ${to}`)
    return match[0]
  }

  async advanceClock(seconds: number) {
    await this.request.post(`${API_URL}/api/v1/test/clock`, { data: { advance_seconds: seconds } })
  }

  async resetClock() {
    await this.request.post(`${API_URL}/api/v1/test/clock`, { data: { reset: true } })
  }

  /** Sign in over the API only (no browser cookie); returns a bearer header. */
  async authHeader(user: TestUser): Promise<Record<string, string>> {
    const response = await this.request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: user.email, password: user.password },
    })
    if (!response.ok()) throw new Error(`login failed: ${await response.text()}`)
    return { Authorization: `Bearer ${(await response.json()).access_token}` }
  }

  async productId(slug: string): Promise<number> {
    const response = await this.request.get(`${API_URL}/api/v1/products/${slug}`)
    return (await response.json()).id
  }

  async addToAccountCart(user: TestUser, slug: string, quantity: number) {
    const response = await this.request.post(`${API_URL}/api/v1/cart/items`, {
      headers: await this.authHeader(user),
      data: { product_id: await this.productId(slug), quantity },
    })
    if (!response.ok()) throw new Error(`add to cart failed: ${await response.text()}`)
  }

  /** Test-only: change a product's price / stock / archived flag. Global state! */
  async changeProduct(
    sku: string,
    change: { price_cents?: number; stock_qty?: number; is_archived?: boolean },
  ) {
    const response = await this.request.patch(`${API_URL}/api/v1/test/products/${sku}`, {
      data: change,
    })
    if (!response.ok()) throw new Error(`change product failed: ${await response.text()}`)
  }
}
