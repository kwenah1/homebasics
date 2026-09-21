import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import * as authApi from '../api/auth'
import type { RegisterInput, User } from '../api/auth'
import { onSessionChange, refreshAccessToken } from '../api/client'

type Status = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  status: Status
  user: User | null
  login: (email: string, password: string) => Promise<User>
  register: (input: RegisterInput) => Promise<User>
  logout: () => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUserState] = useState<User | null>(null)

  const setUser = useCallback((next: User) => {
    setUserState(next)
    setStatus('authenticated')
  }, [])

  const clear = useCallback(() => {
    setUserState(null)
    setStatus('anonymous')
    queryClient.removeQueries({ queryKey: ['me'] })
  }, [queryClient])

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false
    refreshAccessToken()
      .then(async (token) => {
        if (!token) return clear()
        const me = await authApi.getMe()
        if (!cancelled) setUser(me)
      })
      .catch(() => !cancelled && clear())
    return () => {
      cancelled = true
    }
  }, [clear, setUser])

  // A background refresh that fails means the session is over (expired, revoked, reused).
  useEffect(() => {
    const unsubscribe = onSessionChange((token) => {
      if (token === null) clear()
    })
    return () => {
      unsubscribe()
    }
  }, [clear])

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      setUser,
      login: async (email, password) => {
        const me = await authApi.login(email, password)
        setUser(me)
        return me
      },
      register: async (input) => {
        const me = await authApi.register(input)
        setUser(me)
        return me
      },
      logout: async () => {
        try {
          await authApi.logout()
        } finally {
          clear()
        }
      },
    }),
    [status, user, setUser, clear],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
