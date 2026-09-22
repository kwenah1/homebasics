/**
 * Guest cart (CRT-02) lives in localStorage until sign-in merges it into the account.
 *
 * Storage is untrusted input: another tab, an old app version or a curious user may have
 * written anything there. Every read is validated and repaired instead of trusted, and
 * storage failures (private mode, quota, disabled) degrade to an empty cart - never a crash.
 */
import { z } from 'zod'

import type { GuestLine } from '../api/cart'

export const STORAGE_KEY = 'hb_guest_cart_v1'
export const MAX_GUEST_LINES = 50
export const MAX_LINE_QTY = 10
const CHANGE_EVENT = 'hb:guest-cart-change'

const lineSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().int(),
  price_cents_seen: z.number().int().nonnegative().optional(),
})

/** Validate + repair raw storage contents into at most 50 distinct lines of qty 1-10. */
export function sanitize(raw: unknown): GuestLine[] {
  if (!Array.isArray(raw)) return []
  const merged = new Map<number, GuestLine>()
  for (const entry of raw) {
    const parsed = lineSchema.safeParse(entry)
    if (!parsed.success || parsed.data.quantity < 1) continue
    const { product_id, quantity, price_cents_seen } = parsed.data
    const existing = merged.get(product_id)
    const line: GuestLine = {
      product_id,
      quantity: Math.min(MAX_LINE_QTY, (existing?.quantity ?? 0) + quantity),
    }
    const seen = existing?.price_cents_seen ?? price_cents_seen // first price seen wins
    if (seen !== undefined) line.price_cents_seen = seen
    merged.set(product_id, line)
  }
  return [...merged.values()].slice(0, MAX_GUEST_LINES)
}

let cachedRaw: string | null | undefined
let cachedLines: GuestLine[] = []

/** Stable snapshot (same array while storage is unchanged) for useSyncExternalStore. */
export function readGuestCart(): GuestLine[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      cachedLines = sanitize(raw ? JSON.parse(raw) : [])
    } catch {
      cachedLines = [] // unparsable JSON
    }
  }
  return cachedLines
}

export function writeGuestCart(lines: GuestLine[]) {
  try {
    if (lines.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(lines)))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the cart simply won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Changes from this tab (custom event) and from other tabs (storage event). */
export function subscribeGuestCart(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export class CartLimitError extends Error {
  readonly maxQuantity: number
  readonly inCart: number

  constructor(maxQuantity: number, inCart: number) {
    super(`You can have at most ${maxQuantity} of this item in your cart.`)
    this.name = 'CartLimitError'
    this.maxQuantity = maxQuantity
    this.inCart = inCart
  }
}

/** Same rule the server applies (CRT-01), so guests get the same answer before sign-in. */
export function addToGuestLines(
  lines: GuestLine[],
  productId: number,
  quantity: number,
  maxQuantity: number,
  priceCents: number,
): GuestLine[] {
  const existing = lines.find((l) => l.product_id === productId)
  const inCart = existing?.quantity ?? 0
  const limit = Math.min(MAX_LINE_QTY, maxQuantity)
  if (inCart + quantity > limit) throw new CartLimitError(limit, inCart)
  if (!existing && lines.length >= MAX_GUEST_LINES) throw new CartLimitError(0, 0)
  return existing
    ? lines.map((l) => (l.product_id === productId ? { ...l, quantity: inCart + quantity } : l))
    : [...lines, { product_id: productId, quantity, price_cents_seen: priceCents }]
}
