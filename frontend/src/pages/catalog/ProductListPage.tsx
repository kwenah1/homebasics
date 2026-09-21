import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { useCategories, useProducts } from '../../api/catalog'
import { ApiError } from '../../api/client'
import { Pagination, ProductCard } from '../../components/catalog'
import { FormAlert } from '../../components/form'
import {
  hasFilters,
  parseListState,
  SORT_OPTIONS,
  toProductQuery,
  toSearchParams,
} from '../../lib/catalogParams'
import type { ListState } from '../../lib/catalogParams'
import { centsToDollarInput, dollarsToCents, formatCents } from '../../lib/money'
import { NotFoundPage } from '../NotFoundPage'

const input =
  'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-500'

function Filters({ state, onChange }: { state: ListState; onChange: (next: Partial<ListState>) => void }) {
  const [q, setQ] = useState(state.q)
  const [min, setMin] = useState(centsToDollarInput(state.min))
  const [max, setMax] = useState(centsToDollarInput(state.max))
  const [priceError, setPriceError] = useState<string | null>(null)

  const apply = (event: FormEvent) => {
    event.preventDefault()
    const minCents = dollarsToCents(min)
    const maxCents = dollarsToCents(max)
    if ((min.trim() && minCents === undefined) || (max.trim() && maxCents === undefined)) {
      return setPriceError('Enter prices like 5 or 12.99.')
    }
    if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
      return setPriceError('Minimum price must not be more than the maximum.')
    }
    setPriceError(null)
    onChange({ q: q.trim(), min: minCents, max: maxCents })
  }

  return (
    <form onSubmit={apply} aria-label="Filter products" className="space-y-4" data-testid="filters">
      <div>
        <label htmlFor="filter-q" className="text-sm font-medium">
          Keywords
        </label>
        <input id="filter-q" className={input} value={q} onChange={(e) => setQ(e.target.value)} data-testid="filter-q" />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Price ($)</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="text-xs text-stone-600">
            Min
            <input className={input} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} data-testid="filter-min" />
          </label>
          <label className="text-xs text-stone-600">
            Max
            <input className={input} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} data-testid="filter-max" />
          </label>
        </div>
        {priceError && (
          <p className="mt-1 text-sm text-red-700" role="alert" data-testid="filter-price-error">
            {priceError}
          </p>
        )}
      </fieldset>
      <button
        type="submit"
        data-testid="filter-apply"
        className="w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900"
      >
        Apply filters
      </button>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.inStock}
          onChange={(e) => onChange({ inStock: e.target.checked })}
          data-testid="filter-in-stock"
        />
        In stock only
      </label>
    </form>
  )
}

export function ProductListPage() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const state = parseListState(params)
  const { data: categories } = useCategories()
  const { data, isPending, isError, error, isPlaceholderData } = useProducts(toProductQuery(state, slug))

  const update = (next: Partial<ListState>) => {
    // Any change other than paging goes back to page 1.
    setParams(toSearchParams({ ...state, page: 1, ...next }))
    if (next.page) window.scrollTo({ top: 0 })
  }

  if (isError && error instanceof ApiError && error.code === 'category_not_found') {
    return <NotFoundPage />
  }

  const category = categories?.find((c) => c.slug === slug)
  const title = slug ? (category?.name ?? '') : state.q ? `Results for “${state.q}”` : 'All products'

  const chips = [
    state.q && `“${state.q}”`,
    state.min !== undefined && `From ${formatCents(state.min)}`,
    state.max !== undefined && `Up to ${formatCents(state.max)}`,
    state.inStock && 'In stock',
  ].filter(Boolean) as string[]

  return (
    <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
      <aside>
        {/* key: remount the inputs whenever the URL's filters change (Back, header search, Clear). */}
        <Filters key={`${state.q}|${state.min}|${state.max}`} state={state} onChange={update} />
      </aside>
      <section aria-labelledby="list-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
              <Link to="/" className="hover:underline">
                Home
              </Link>
              {slug && <span> / {category?.name}</span>}
            </nav>
            <h1 id="list-heading" className="text-2xl font-bold tracking-tight" data-testid="list-heading">
              {title}
            </h1>
            <p className="text-sm text-stone-600" data-testid="result-count" aria-live="polite">
              {data ? `${data.total} ${data.total === 1 ? 'product' : 'products'}` : ' '}
            </p>
          </div>
          <label className="text-sm">
            <span className="mr-2 text-stone-600">Sort by</span>
            <select
              value={state.sort}
              onChange={(e) => update({ sort: e.target.value as ListState['sort'] })}
              data-testid="sort"
              className="rounded-lg border border-stone-300 bg-white px-2 py-1.5"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
            {chips.map((chip) => (
              <span key={chip} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-900">
                {chip}
              </span>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-brand-700 underline"
              onClick={() => update({ q: '', min: undefined, max: undefined, inStock: false })}
              data-testid="clear-filters"
            >
              Clear all
            </button>
          </div>
        )}

        {isError && <FormAlert message="We couldn't load products. Please try again." testId="list-error" />}
        {isPending && (
          <p className="text-sm text-stone-500" data-testid="list-loading">
            Loading products…
          </p>
        )}

        {data && data.total === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-center" data-testid="list-empty">
            <p className="font-medium">No products match.</p>
            {hasFilters(state) && <p className="text-sm text-stone-600">Try removing a filter.</p>}
          </div>
        )}

        {data && data.items.length > 0 && (
          <ul
            className={`grid grid-cols-2 gap-4 lg:grid-cols-3 ${isPlaceholderData ? 'opacity-60' : ''}`}
            data-testid="product-grid"
            aria-busy={isPlaceholderData || undefined}
          >
            {data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        )}

        {data && data.total > 0 && data.items.length === 0 && (
          <p data-testid="page-out-of-range" className="text-sm text-stone-600">
            That page doesn't exist.{' '}
            <button type="button" className="text-brand-700 underline" onClick={() => update({ page: 1 })}>
              Go to page 1
            </button>
          </p>
        )}

        {data && <Pagination page={state.page} pages={data.pages} onPage={(page) => update({ page })} />}
      </section>
    </div>
  )
}
