import { Link } from 'react-router-dom'

import { CATEGORIES } from '../data/categories'

export function HomePage() {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-brand-700 px-8 py-12 text-cream">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everyday essentials, delivered.
        </h1>
        <p className="mt-3 max-w-xl text-brand-100">
          Kitchen, cleaning, bath and more. Free standard shipping on orders of $50 or more.
        </p>
      </section>

      <section aria-labelledby="shop-by-category">
        <h2 id="shop-by-category" className="mb-4 text-xl font-semibold">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <li key={c.slug}>
              <Link
                to={`/c/${c.slug}`}
                data-testid={`category-tile-${c.slug}`}
                className="block rounded-xl border border-stone-200 bg-white p-5 transition hover:border-brand-500 hover:shadow-sm"
              >
                <span aria-hidden="true" className="text-3xl">
                  {c.emoji}
                </span>
                <span className="mt-2 block font-semibold">{c.name}</span>
                <span className="block text-sm text-stone-500">{c.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
