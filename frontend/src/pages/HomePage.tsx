import { Link } from 'react-router-dom'

import { useCategories } from '../api/catalog'
import { CATEGORY_STYLE } from '../data/categories'

export function HomePage() {
  const { data: categories = [], isError } = useCategories()

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-brand-700 px-8 py-12 text-cream">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everyday essentials, delivered.
        </h1>
        <p className="mt-3 max-w-xl text-brand-100">
          Kitchen, cleaning, bath and more. Free standard shipping on orders of $50 or more.
        </p>
        <Link
          to="/products"
          data-testid="shop-all"
          className="mt-6 inline-block rounded-full bg-cream px-5 py-2 text-sm font-semibold text-brand-900 hover:bg-white"
        >
          Shop all products
        </Link>
      </section>

      <section aria-labelledby="shop-by-category">
        <h2 id="shop-by-category" className="mb-4 text-xl font-semibold">
          Shop by category
        </h2>
        {isError && <p className="text-sm text-red-700">Categories are unavailable right now.</p>}
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {categories.map((c) => {
            const style = CATEGORY_STYLE[c.slug] ?? CATEGORY_STYLE.default
            return (
              <li key={c.slug}>
                <Link
                  to={`/c/${c.slug}`}
                  data-testid={`category-tile-${c.slug}`}
                  className="block rounded-xl border border-stone-200 bg-white p-5 transition hover:border-brand-500 hover:shadow-sm"
                >
                  <span aria-hidden="true" className="text-3xl">
                    {style.emoji}
                  </span>
                  <span className="mt-2 block font-semibold">{c.name}</span>
                  <span className="block text-sm text-stone-600">{style.blurb}</span>
                  <span className="mt-1 block text-xs text-stone-500">{c.product_count} products</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
