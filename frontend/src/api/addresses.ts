import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from './client'

export interface Address {
  id: number
  label: string
  recipient_name: string
  line1: string
  line2: string | null
  city: string
  state: string
  postal_code: string
  is_default: boolean
}

export type AddressInput = Omit<Address, 'id' | 'is_default' | 'line2'> & {
  line2?: string
  is_default?: boolean
}

export interface UsState {
  code: string
  name: string
}

export const MAX_ADDRESSES = 5

const KEY = ['me', 'addresses']

export function useAddresses() {
  return useQuery({ queryKey: KEY, queryFn: () => apiFetch<Address[]>('/me/addresses', { auth: true }) })
}

export function useStates() {
  return useQuery({
    queryKey: ['states'],
    queryFn: () => apiFetch<UsState[]>('/states'),
    staleTime: Infinity,
  })
}

function useInvalidating<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export const useCreateAddress = () =>
  useInvalidating((input: AddressInput) =>
    apiFetch<Address>('/me/addresses', { method: 'POST', json: input, auth: true }),
  )

export const useUpdateAddress = () =>
  useInvalidating(({ id, ...changes }: Partial<AddressInput> & { id: number }) =>
    apiFetch<Address>(`/me/addresses/${id}`, { method: 'PATCH', json: changes, auth: true }),
  )

export const useSetDefaultAddress = () =>
  useInvalidating((id: number) =>
    apiFetch<Address>(`/me/addresses/${id}/default`, { method: 'POST', auth: true }),
  )

export const useDeleteAddress = () =>
  useInvalidating((id: number) =>
    apiFetch<void>(`/me/addresses/${id}`, { method: 'DELETE', auth: true }),
  )
