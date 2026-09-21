import { useQuery } from '@tanstack/react-query'

import { ApiError, apiFetch } from './client'

export interface Health {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unavailable'
  version: string
  environment: string
}

export async function getHealth(): Promise<Health> {
  try {
    return await apiFetch<Health>('/health')
  } catch (error) {
    // A 503 still carries a meaningful health body.
    if (error instanceof ApiError && error.status === 503) return error.body as Health
    throw error
  }
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 30_000, retry: 0 })
}
