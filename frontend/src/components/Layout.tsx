import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { useCategories } from '../api/catalog'
import { useAuth } from '../auth/AuthContext'
import { ApiStatus } from './ApiStatus'

function AccountLinks() {
  const { status, user, logout } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') return <span className="w-16" aria-hidden="true" />
  if (status === 'anonymous' || !user) {
    return (
      <Link to="/login" data-testid="nav-login" className="hover:text-brand-700">
        Sign in
      </Link>
    )
  }
  return (
    <>
      <Link to="/account" data-testid="nav-account" className="hover:text-brand-700">
        Hi, <span data-testid="nav-user-name">{user.first_name}</span>
      </Link>
      <button
        type="button"
        data-testid="nav-logout"
        className="hover:text-brand-700"
        onClick={async () => {
          await logout()
          navigate('/')
        }}
      >
        Sign out
      </button>
    </>
  )
}

function HeaderSearch({ initial }: { initial: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initial)

  return (
    <form
      role="search"
      className="hidden max-w-md flex-1 sm:block"
      onSubmit={(e) => {
        e.preventDefault()
        const term = q.trim()
        navigate(term ? `/products?q=${encodeURIComponent(term)}` : '/products')
      }}
    >
      <label htmlFor="header-search" className="sr-only">
        Search products
      </label>
      <input
        id="header-search"
        type="search"
        placeholder="Search towels, sponges, bins…"
        value={q}
        maxLength={100}
        onChange={(e) => setQ(e.target.value)}
        data-testid="header-search"
        className="w-full rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-sm focus:border-brand-500 focus:bg-white"
      />
    </form>
  )
}

export function Layout() {
  const { data: categories = [] } = useCategories()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // On the results page the box mirrors the current search; the key remounts it when the
  // URL changes (Back button, filter edits) so it never shows a stale term.
  const headerQuery = pathname === '/products' ? (params.get('q') ?? '') : ''
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
          <HeaderSearch key={pathname + headerQuery} initial={headerQuery} />
          <nav aria-label="Account" className="flex items-center gap-5 text-sm font-medium">
            <AccountLinks />
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
            {categories.map((c) => (
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
