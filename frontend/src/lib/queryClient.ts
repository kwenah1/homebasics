import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '../api/client'

/**
 * Retry only failures that might succeed next time (network errors, 5xx), at most twice.
 * A 4xx is final: retrying a 404 just delays the "not found" page by ~7 seconds (the
 * library default is 3 retries with backoff).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 2
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  })
}
