import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { Health } from '../api/health'

export const healthyResponse: Health = {
  status: 'ok',
  database: 'ok',
  version: '0.1.0',
  environment: 'test',
}

// Default happy-path handlers; override per test with server.use(...).
export const handlers = [http.get('/api/v1/health', () => HttpResponse.json(healthyResponse))]

export const server = setupServer(...handlers)
