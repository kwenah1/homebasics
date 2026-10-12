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

  async addAddress(
    user: TestUser,
    overrides: Partial<{ label: string; state: string; city: string; postal_code: string }> = {},
  ): Promise<number> {
    const response = await this.request.post(`${API_URL}/api/v1/me/addresses`, {
      headers: await this.authHeader(user),
      data: {
        label: 'Home',
        recipient_name: `${user.firstName} ${user.lastName}`,
        line1: '100 Congress Ave',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        ...overrides,
      },
    })
    if (response.status() !== 201) throw new Error(`add address failed: ${await response.text()}`)
    return (await response.json()).id
  }

  async expireOrdersNow() {
    return (await this.request.post(`${API_URL}/api/v1/test/expire-orders`)).json()
  }

  // --- Admin (ADM) - the real back-office API, as the seeded admin -------------------------

  private adminAuth?: Promise<Record<string, string>>

  admin(): Promise<Record<string, string>> {
    this.adminAuth ??= this.authHeader(ADMIN_USER)
    return this.adminAuth
  }

  async adminProductBySku(sku: string) {
    const response = await this.request.get(`${API_URL}/api/v1/admin/products`, {
      headers: await this.admin(),
      params: { q: sku },
    })
    const product = (await response.json()).items.find((p: { sku: string }) => p.sku === sku)
    if (!product) throw new Error(`no product ${sku}`)
    return product as { id: number; sku: string; slug: string; stock_qty: number; price_cents: number }
  }

  async ledger(sku: string): Promise<{ order_number: string | null; reason: string; delta: number }[]> {
    const product = await this.adminProductBySku(sku)
    const response = await this.request.get(`${API_URL}/api/v1/admin/products/${product.id}/stock-movements`, {
      headers: await this.admin(),
    })
    return (await response.json()).movements
  }

  async setOrderStatus(orderNumber: string, to: 'processing' | 'shipped' | 'delivered' | 'cancelled') {
    const response = await this.request.post(`${API_URL}/api/v1/admin/orders/${orderNumber}/status`, {
      headers: await this.admin(),
      data: { to },
    })
    if (!response.ok()) throw new Error(`status change failed: ${await response.text()}`)
  }

  /**
   * Change a product's price / stock / archived flag through the admin API. On a seeded
   * product this is global state: use it only in the isolated project.
   */
  async changeProduct(
    sku: string,
    change: { price_cents?: number; stock_qty?: number; is_archived?: boolean },
  ) {
    const headers = await this.admin()
    const product = await this.adminProductBySku(sku)
    const base = `${API_URL}/api/v1/admin/products/${product.id}`
    const check = async (r: import('@playwright/test').APIResponse) => {
      if (!r.ok()) throw new Error(`change product failed: ${await r.text()}`)
    }
    if (change.price_cents !== undefined) {
      await check(await this.request.patch(base, { headers, data: { price_cents: change.price_cents } }))
    }
    if (change.stock_qty !== undefined && change.stock_qty !== product.stock_qty) {
      await check(
        await this.request.post(`${base}/stock-adjustments`, {
          headers,
          data: { delta: change.stock_qty - product.stock_qty, reason: 'adjustment', note: 'e2e' },
        }),
      )
    }
    if (change.is_archived !== undefined) {
      await check(await this.request.post(`${base}/${change.is_archived ? 'archive' : 'unarchive'}`, { headers }))
    }
  }

  // --- Phase 2 (M8) ---------------------------------------------------------------------------

  async createCoupon(body: Record<string, unknown>) {
    const response = await this.request.post(`${API_URL}/api/v1/admin/coupons`, {
      headers: await this.admin(),
      data: { kind: 'percent', percent_off: 10, per_user_limit: 5, ...body },
    })
    if (response.status() !== 201) throw new Error(`create coupon failed: ${await response.text()}`)
    return response.json()
  }

  /** Buy through the real checkout API (cart -> quote -> place -> pay) and, as staff, walk the
   *  order to DELIVERED. Returns the order number. */
  async buyAndDeliver(user: TestUser, slug: string, quantity: number, opts: { deliver?: boolean } = {}) {
    const headers = await this.authHeader(user)
    await this.addToAccountCart(user, slug, quantity)
    const addresses = await (await this.request.get(`${API_URL}/api/v1/me/addresses`, { headers })).json()
    const address_id = addresses[0]?.id ?? (await this.addAddress(user))
    const quote = await (
      await this.request.post(`${API_URL}/api/v1/checkout/quote`, { headers, data: { address_id } })
    ).json()
    const placed = await this.request.post(`${API_URL}/api/v1/checkout/place-order`, {
      headers: { ...headers, 'Idempotency-Key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
      data: { address_id, expected_total_cents: quote.total_cents },
    })
    if (placed.status() !== 201) throw new Error(`place failed: ${await placed.text()}`)
    const { order_number } = await placed.json()
    const paid = await this.request.post(`${API_URL}/api/v1/orders/${order_number}/pay`, {
      headers: { ...headers, 'Idempotency-Key': `e2e-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      data: { card_number: '4242424242424242', exp_month: 12, exp_year: 2035, cvc: '123', name_on_card: 'E2E' },
    })
    if (!paid.ok()) throw new Error(`pay failed: ${await paid.text()}`)
    if (opts.deliver !== false) {
      for (const to of ['processing', 'shipped', 'delivered'] as const) await this.setOrderStatus(order_number, to)
    }
    return order_number as string
  }

  async emailsTo(to: string, limit = 20): Promise<{ subject: string; body: string }[]> {
    const response = await this.request.get(`${API_URL}/api/v1/test/emails`, { params: { to, limit } })
    return response.json()
  }
}

export const ADMIN_USER: TestUser = {
  email: 'admin@homebasics.test',
  password: 'Admin12345',
  firstName: 'Ada',
  lastName: 'Admin',
}
