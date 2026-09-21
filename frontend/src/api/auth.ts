import { apiFetch, setAccessToken } from './client'

export interface User {
  id: number
  email: string
  first_name: string
  last_name: string
  role: 'customer' | 'admin'
  created_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  user: User
}

export interface RegisterInput {
  email: string
  password: string
  first_name: string
  last_name: string
}

async function startSession(path: string, json: unknown): Promise<User> {
  const body = await apiFetch<TokenResponse>(path, { method: 'POST', json })
  setAccessToken(body.access_token)
  return body.user
}

export const register = (input: RegisterInput) => startSession('/auth/register', input)

export const login = (email: string, password: string) =>
  startSession('/auth/login', { email, password })

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' })
  } finally {
    setAccessToken(null)
  }
}

export const forgotPassword = (email: string) =>
  apiFetch<{ message: string }>('/auth/forgot-password', { method: 'POST', json: { email } })

export const resetPassword = (token: string, new_password: string) =>
  apiFetch<void>('/auth/reset-password', { method: 'POST', json: { token, new_password } })

export const getMe = () => apiFetch<User>('/me', { auth: true })

export const updateProfile = (changes: Pick<User, 'first_name' | 'last_name'>) =>
  apiFetch<User>('/me', { method: 'PATCH', json: changes, auth: true })

export async function changePassword(current_password: string, new_password: string) {
  // The server signs out every session and hands this device a fresh one.
  const body = await apiFetch<TokenResponse>('/me/password', {
    method: 'POST',
    json: { current_password, new_password },
    auth: true,
  })
  setAccessToken(body.access_token)
  return body.user
}
