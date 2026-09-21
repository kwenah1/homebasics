import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client'
import { shouldRetry } from '../lib/queryClient'

describe('shouldRetry (regression: 404 page took ~7s to appear)', () => {
  it.each([400, 401, 403, 404, 409, 422, 423])('never retries a %i', (status) => {
    expect(shouldRetry(0, new ApiError(status, {}))).toBe(false)
  })

  it.each([500, 502, 503])('retries a %i up to twice', (status) => {
    const error = new ApiError(status, {})
    expect([0, 1, 2].map((n) => shouldRetry(n, error))).toEqual([true, true, false])
  })

  it('retries network failures up to twice', () => {
    const error = new TypeError('Failed to fetch')
    expect([0, 1, 2].map((n) => shouldRetry(n, error))).toEqual([true, true, false])
  })
})
