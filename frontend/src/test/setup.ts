import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

// jsdom has no origin for relative URLs; give fetch one so '/api/v1/...' resolves.
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  realFetch(typeof input === 'string' ? new URL(input, 'http://localhost') : input, init)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
