import { Link } from 'react-router-dom'

import type { ProductSummary, StockStatus } from '../api/catalog'
import { CATEGORY_STYLE } from '../data/categories'
import { formatCents } from '../lib/money'

export function StockBadge({ status, left }: { status: StockStatus; left: number | null }) {
  const [text, style] =
    status === 'out_of_stock'
      ? ['Out of stock', 'bg-stone-200 text-stone-700']
      : status === 'low_stock'
        ? [`Only ${left} left`, 'bg-amber-100 text-amber-900']
        : ['In stock', 'bg-emerald-50 text-emerald-800']
  return (
    <span
      data-testid="stock-badge"
      data-status={status}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {text}
    </span>
  )
}

export function Rating({ avg, count }: { avg: number | null; count: number }) {
  if (avg === null || count === 0) {
    return (
      <span data-testid="rating" className="text-xs text-stone-500">
        No reviews yet
      </span>
    )
  }
  return (
    <span
      data-testid="rating"
      className="text-xs text-stone-600"
      aria-label={`Rated ${avg.toFixed(1)} out of 5 from ${count} reviews`}
    >
      <span aria-hidden="true" className="text-amber-600">
        ★
      </span>{' '}
      {avg.toFixed(1)} <span className="text-stone-500">({count})</span>
    </span>
  )
}

export function ProductImage({ slug, name, size = 'md' }: { slug: string; name: string; size?: 'md' | 'lg' }) {
  // No product photos yet: a category-coloured tile with the category emoji.
  const style = CATEGORY_STYLE[slug] ?? CATEGORY_STYLE.default
  return (
    <div
      role="img"
      aria-label={name}
      className={`flex items-center justify-center rounded-xl ${style.bg} ${size === 'lg' ? 'aspect-square text-7xl' : 'aspect-[4/3] text-4xl'}`}
    >
      <span aria-hidden="true">{style.emoji}</span>
    </div>
  )
}

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <li
      data-testid="product-card"
      data-sku={product.sku}
      className="group flex flex-col rounded-2xl border border-stone-200 bg-white p-3 transition hover:border-brand-500 hover:shadow-sm"
    >
      <Link to={`/p/${product.slug}`} className="flex flex-1 flex-col gap-2" data-testid="product-link">
        <ProductImage slug={product.category.slug} name={product.name} />
        <span className="line-clamp-2 font-medium group-hover:text-brand-700" data-testid="product-name">
          {product.name}
        </span>
        <span className="mt-auto flex items-center justify-between gap-2">
          <span className="font-semibold" data-testid="product-price">
            {formatCents(product.price_cents)}
          </span>
          <StockBadge status={product.stock_status} left={product.stock_left} />
        </span>
        <Rating avg={product.rating_avg} count={product.rating_count} />
      </Link>
    </li>
  )
}

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage: (page: number) => void
}) {
  if (pages <= 1) return null
  const button =
    'rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3" data-testid="pagination">
      <button type="button" className={button} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="page-prev">
        Previous
      </button>
      <span className="text-sm text-stone-600" data-testid="page-indicator" aria-current="page">
        Page {page} of {pages}
      </span>
      <button type="button" className={button} disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="page-next">
        Next
      </button>
    </nav>
  )
}
