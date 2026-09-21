import { Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="c/:slug" element={<PlaceholderPage title="Category" milestone={3} />} />
        <Route path="login" element={<PlaceholderPage title="Sign in" milestone={2} />} />
        <Route path="cart" element={<PlaceholderPage title="Your cart" milestone={4} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
