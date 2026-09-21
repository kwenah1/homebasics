import { Link, NavLink, Outlet } from 'react-router-dom'

import { CATEGORIES } from '../data/categories'
import { ApiStatus } from './ApiStatus'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" data-testid="nav-home" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-xl font-bold tracking-tight text-brand-900">HomeBasics</span>
          </Link>
          <nav aria-label="Account" className="flex items-center gap-5 text-sm font-medium">
            <Link to="/login" data-testid="nav-login" className="hover:text-brand-700">
              Sign in
            </Link>
            <Link
              to="/cart"
              data-testid="nav-cart"
              aria-label="Cart, 0 items"
              className="rounded-full bg-brand-700 px-4 py-2 text-white hover:bg-brand-900"
            >
              Cart <span data-testid="cart-count">0</span>
            </Link>
          </nav>
        </div>
        <nav aria-label="Categories" className="border-t border-stone-100">
          <ul className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-4 py-2 text-sm">
            {CATEGORIES.map((c) => (
              <li key={c.slug}>
                <NavLink
                  to={`/c/${c.slug}`}
                  data-testid={`nav-category-${c.slug}`}
                  className={({ isActive }) =>
                    `whitespace-nowrap hover:text-brand-700 ${isActive ? 'font-semibold text-brand-700' : ''}`
                  }
                >
                  {c.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-stone-500">
          <span>© {new Date().getFullYear()} HomeBasics - a practice store for SDET training.</span>
          <ApiStatus />
        </div>
      </footer>
    </div>
  )
}
