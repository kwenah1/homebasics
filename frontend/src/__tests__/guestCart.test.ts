import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addToGuestLines,
  CartLimitError,
  readGuestCart,
  sanitize,
  STORAGE_KEY,
  subscribeGuestCart,
  writeGuestCart,
} from '../cart/guestCart'

describe('sanitize (storage is untrusted input)', () => {
  it.each([
    ['not an array', { product_id: 1, quantity: 1 }],
    ['a string', 'hello'],
    ['null', null],
    ['a number', 42],
  ])('%s -> empty cart', (_label, raw) => {
    expect(sanitize(raw)).toEqual([])
  })

  it('drops malformed lines and keeps good ones', () => {
    expect(
      sanitize([
        { product_id: 1, quantity: 2 },
        { product_id: -5, quantity: 1 }, // bad id
        { product_id: 2, quantity: 0 }, // zero
        { product_id: 3, quantity: -4 }, // negative
        { product_id: 4, quantity: 1.5 }, // fractional
        { product_id: '7', quantity: 1 }, // wrong type
        { quantity: 1 }, // missing id
        null,
        { product_id: 8, quantity: 1, price_cents_seen: -1 }, // bad price
      ]),
    ).toEqual([{ product_id: 1, quantity: 2 }])
  })

  it('caps quantity at 10', () => {
    expect(sanitize([{ product_id: 1, quantity: 999 }])).toEqual([{ product_id: 1, quantity: 10 }])
  })

  it('merges duplicate products, capped, keeping the first price seen', () => {
    expect(
      sanitize([
        { product_id: 1, quantity: 6, price_cents_seen: 100 },
        { product_id: 1, quantity: 7, price_cents_seen: 200 },
      ]),
    ).toEqual([{ product_id: 1, quantity: 10, price_cents_seen: 100 }])
  })

  it('keeps at most 50 lines', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ product_id: i + 1, quantity: 1 }))
    expect(sanitize(many)).toHaveLength(50)
  })
})

describe('reading and writing storage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('round-trips', () => {
    writeGuestCart([{ product_id: 3, quantity: 2, price_cents_seen: 499 }])
    expect(readGuestCart()).toEqual([{ product_id: 3, quantity: 2, price_cents_seen: 499 }])
  })

  it('writing an empty cart removes the key', () => {
    writeGuestCart([{ product_id: 3, quantity: 2 }])
    writeGuestCart([])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('unparsable JSON reads as empty', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(readGuestCart()).toEqual([])
  })

  it('returns the same array while storage is unchanged (stable snapshot)', () => {
    writeGuestCart([{ product_id: 3, quantity: 2 }])
    expect(readGuestCart()).toBe(readGuestCart())
  })

  it('survives storage being unavailable (private mode / quota)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeGuestCart([{ product_id: 1, quantity: 1 }])).not.toThrow()
    expect(readGuestCart()).toEqual([])
  })

  it('notifies subscribers for this tab and for other tabs', () => {
    const onChange = vi.fn()
    const unsubscribe = subscribeGuestCart(onChange)
    writeGuestCart([{ product_id: 1, quantity: 1 }]) // this tab
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY })) // another tab
    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else' })) // ignored
    expect(onChange).toHaveBeenCalledTimes(2)
    unsubscribe()
    writeGuestCart([])
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('addToGuestLines (same limits as the server, CRT-01)', () => {
  it('adds a new line remembering the price seen', () => {
    expect(addToGuestLines([], 1, 2, 10, 2499)).toEqual([{ product_id: 1, quantity: 2, price_cents_seen: 2499 }])
  })

  it('increments an existing line and keeps its original price', () => {
    const lines = [{ product_id: 1, quantity: 2, price_cents_seen: 2499 }]
    expect(addToGuestLines(lines, 1, 3, 10, 2999)).toEqual([{ product_id: 1, quantity: 5, price_cents_seen: 2499 }])
  })

  it.each([
    [10, 0, 10, true], // exactly 10 allowed
    [1, 10, 10, false], // 11th rejected
    [5, 0, 5, true], // exactly stock
    [1, 5, 5, false], // stock + 1
  ])('adding %i to %i with max %i -> allowed=%s', (qty, inCart, max, allowed) => {
    const lines = inCart ? [{ product_id: 1, quantity: inCart }] : []
    const attempt = () => addToGuestLines(lines, 1, qty, max, 100)
    if (allowed) expect(attempt).not.toThrow()
    else expect(attempt).toThrow(CartLimitError)
  })

  it('reports the limit and what is already in the cart', () => {
    try {
      addToGuestLines([{ product_id: 1, quantity: 4 }], 1, 3, 5, 100)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CartLimitError)
      expect((e as CartLimitError).maxQuantity).toBe(5)
      expect((e as CartLimitError).inCart).toBe(4)
    }
  })
})
