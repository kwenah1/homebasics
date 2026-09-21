import { describe, expect, it } from 'vitest'

import { toApiParams } from '../api/catalog'
import { parseListState, toProductQuery, toSearchParams } from '../lib/catalogParams'
import { centsToDollarInput, dollarsToCents, formatCents } from '../lib/money'

describe('money', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [4999, '$49.99'],
    [5000, '$50.00'],
    [123456, '$1,234.56'],
  ])('formatCents(%i) = %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text)
  })

  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['$49.99', 4999],
    ['0', 0],
    [' 7 ', 700],
    ['12.', 1200],
  ])('dollarsToCents(%j) = %i', (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents)
  })

  it.each(['', 'abc', '-5', '1.234', '1,000', '1e3', null, undefined])(
    'dollarsToCents(%j) is undefined',
    (input) => {
      expect(dollarsToCents(input)).toBeUndefined()
    },
  )

  it('round-trips cents through the input format without float drift', () => {
    for (const cents of [0, 1, 99, 1999, 4999, 5000, 10001]) {
      expect(dollarsToCents(centsToDollarInput(cents))).toBe(cents)
    }
  })
})

describe('URL <-> list state', () => {
  const parse = (qs: string) => parseListState(new URLSearchParams(qs))

  it('defaults for an empty URL', () => {
    expect(parse('')).toEqual({ q: '', min: undefined, max: undefined, inStock: false, sort: 'name', page: 1 })
  })

  it('parses a full URL', () => {
    expect(parse('q=towel&min=10&max=49.99&in_stock=1&sort=price_desc&page=2')).toEqual({
      q: 'towel',
      min: 1000,
      max: 4999,
      inStock: true,
      sort: 'price_desc',
      page: 2,
    })
  })

  it.each([
    ['sort=cheapest', { sort: 'name' }],
    ['page=0', { page: 1 }],
    ['page=-3', { page: 1 }],
    ['page=2.5', { page: 1 }],
    ['page=abc', { page: 1 }],
    ['min=abc', { min: undefined }],
    ['in_stock=true', { inStock: false }], // only "1" counts
  ])('sanitizes %s', (qs, expected) => {
    expect(parse(qs)).toMatchObject(expected)
  })

  it('swaps a reversed price range instead of erroring', () => {
    expect(parse('min=50&max=10')).toMatchObject({ min: 1000, max: 5000 })
  })

  it('round-trips and omits defaults from the URL', () => {
    const qs = 'q=bath+towel&min=5&in_stock=1&sort=rating&page=3'
    expect(toSearchParams(parse(qs)).toString()).toBe(qs)
    expect(toSearchParams(parse('sort=name&page=1')).toString()).toBe('')
  })

  it('maps to API params in cents', () => {
    const query = toProductQuery(parse('q=towel&max=10&in_stock=1'), 'bath')
    expect(toApiParams(query)).toBe('category=bath&q=towel&max_price_cents=1000&in_stock=true&sort=name&page=1')
  })
})
