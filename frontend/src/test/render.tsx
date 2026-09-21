import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { AppRoutes } from '../App'
import { setAccessToken } from '../api/client'
import { AuthProvider } from '../auth/AuthContext'
import { CartProvider } from '../cart/CartContext'

/** Render with a fresh QueryClient and auth state (no retries, no shared cache). */
export function renderWithProviders(ui: ReactElement, { route = '/' } = {}) {
  setAccessToken(null)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

export function renderApp(route = '/') {
  return renderWithProviders(<AppRoutes />, { route })
}
