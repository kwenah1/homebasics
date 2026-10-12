import { NavLink, Outlet } from 'react-router-dom'

const LINKS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/categories', label: 'Categories' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/returns', label: 'Returns' },
  { to: '/admin/coupons', label: 'Coupons' },
  { to: '/admin/reviews', label: 'Reviews' },
]

export function AdminLayout() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-900 px-4 py-3 text-stone-100">
        <span className="text-sm font-semibold tracking-wide">HomeBasics back office</span>
        <nav aria-label="Admin">
          <ul className="flex flex-wrap gap-4 text-sm">
            {LINKS.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  data-testid={`admin-nav-${l.label.toLowerCase()}`}
                  className={({ isActive }) => (isActive ? 'font-semibold text-white underline' : 'text-stone-300 hover:text-white')}
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
