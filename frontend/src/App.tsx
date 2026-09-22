import { Route, Routes } from 'react-router-dom'

import { RequireAdmin } from './auth/RequireAdmin'
import { RequireAuth } from './auth/RequireAuth'
import { AdminCategories } from './pages/admin/AdminCategories'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminOrderDetail, AdminOrders } from './pages/admin/AdminOrders'
import { AdminProductDetail, AdminProductNew, AdminProducts } from './pages/admin/AdminProducts'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/account/AccountPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { CartPage } from './pages/cart/CartPage'
import { ProductDetailPage } from './pages/catalog/ProductDetailPage'
import { ProductListPage } from './pages/catalog/ProductListPage'
import { HomePage } from './pages/HomePage'
import { CheckoutPage } from './pages/checkout/CheckoutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OrderDetailPage, OrdersPage } from './pages/orders/OrderPages'
import { PayPage } from './pages/orders/PayPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="products" element={<ProductListPage />} />
        <Route path="c/:slug" element={<ProductListPage />} />
        <Route path="p/:slug" element={<ProductDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route element={<RequireAuth />}>
          <Route path="account" element={<AccountPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:orderNumber" element={<OrderDetailPage />} />
          <Route path="orders/:orderNumber/pay" element={<PayPage />} />
        </Route>
        <Route element={<RequireAdmin />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="products/new" element={<AdminProductNew />} />
            <Route path="products/:id" element={<AdminProductDetail />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="orders/:orderNumber" element={<AdminOrderDetail />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
