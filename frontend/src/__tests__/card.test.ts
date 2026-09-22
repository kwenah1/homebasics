import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client'
import { expiryInPast, formatCardNumber, luhnValid, newIdempotencyKey, parseExpiry } from '../lib/card'
import { shouldKeepKey } from '../lib/idempotency'
import { formatRate } from '../lib/money'

describe('card helpers (mirror the server)', () => {
  it.each(['4242424242424242', '4242 4242 4242 4242', '4000-0000-0000-0002', '378282246310005'])(
    'Luhn valid: %s',
    (n) => expect(luhnValid(n)).toBe(true),
  )

  it.each(['4242424242424241', '1234', '', 'abcd efgh ijkl mnop'])('Luhn invalid: %j', (n) => {
    expect(luhnValid(n)).toBe(false)
  })

  it('formats as groups of four', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('42x42')).toBe('4242')
  })

  it.each([
    ['12/35', { month: 12, year: 2035 }],
    ['1/30', { month: 1, year: 2030 }],
    ['07 / 2031', { month: 7, year: 2031 }],
    ['13/30', null],
    ['00/30', null],
    ['1230', null],
    ['', null],
  ])('parseExpiry(%j)', (input, expected) => {
    expect(parseExpiry(input)).toEqual(expected)
  })

  it('a card is good through the end of its month', () => {
    const now = new Date(2030, 1, 28) // Feb 2030
    expect(expiryInPast(2, 2030, now)).toBe(false)
    expect(expiryInPast(1, 2030, now)).toBe(true)
    expect(expiryInPast(12, 2029, now)).toBe(true)
  })

  it('idempotency keys are unique and within the 8-48 char limit', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey))
    expect(keys.size).toBe(50)
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{8,48}$/)
  })
})

describe('shouldKeepKey (CHK-08 retry rule)', () => {
  it('keeps the key when we never got an answer', () => {
    expect(shouldKeepKey(new TypeError('Failed to fetch'))).toBe(true)
  })
  it.each([500, 502, 503])('keeps the key after a %i', (status) => {
    expect(shouldKeepKey(new ApiError(status, {}))).toBe(true)
  })
  it.each([402, 409, 422])('needs a new key after a definitive %i', (status) => {
    expect(shouldKeepKey(new ApiError(status, {}))).toBe(false)
  })
})

describe('formatRate', () => {
  it.each([
    [0.0825, '8.25%'],
    [0.06, '6%'],
    [0.06875, '6.875%'],
    [0, '0%'],
  ])('%f -> %s', (rate, text) => expect(formatRate(rate)).toBe(text))
})
