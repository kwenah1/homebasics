import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useProduct } from '../../api/catalog'
import { ApiError } from '../../api/client'
import { ProductImage, Rating, StockBadge } from '../../components/catalog'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'
import { NotFoundPage } from '../NotFoundPage'

export function ProductDetailPage() {
  const { slug = '' } = useParams()
  const { data: product, isPending, isError, error } = useProduct(slug)
  const [qty, setQty] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)

  if (isError && error instanceof ApiError && error.status === 404) return <NotFoundPage />
  if (isError) return <FormAlert message="We couldn't load this product." testId="detail-error" />
  if (isPending) {
    return (
      <p className="text-sm text-stone-500" data-testid="detail-loading">
        Loading…
      </p>
    )
  }

  const soldOut = product.max_order_qty === 0

  return (
    <article className="space-y-6" data-testid="product-detail" data-sku={product.sku}>
      <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
        <Link to="/" className="hover:underline">
          Home
        </Link>{' '}
        /{' '}
        <Link to={`/c/${product.category.slug}`} className="hover:underline" data-testid="breadcrumb-category">
          {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <ProductImage slug={product.category.slug} name={product.name} size="lg" />

        <div className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="detail-name">
            {product.name}
          </h1>
          <Rating avg={product.rating_avg} count={product.rating_count} />
          <p className="text-2xl font-semibold" data-testid="detail-price">
            {formatCents(product.price_cents)}
          </p>
          <StockBadge status={product.stock_status} left={product.stock_left} />
          <p className="text-stone-700" data-testid="detail-description">
            {product.description}
          </p>
          <p className="text-xs text-stone-500">SKU {product.sku}</p>

          <div className="flex items-end gap-3 pt-2">
            <label className="text-sm">
              <span className="block font-medium">Quantity</span>
              <select
                value={qty}
                disabled={soldOut}
                onChange={(e) => setQty(Number(e.target.value))}
                data-testid="detail-qty"
                className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 disabled:opacity-50"
              >
                {Array.from({ length: Math.max(1, product.max_order_qty) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={soldOut}
              data-testid="add-to-cart"
              onClick={() => setNotice(`Cart arrives in Milestone 4 - you picked ${qty}.`)}
              className="flex-1 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {soldOut ? 'Out of stock' : 'Add to cart'}
            </button>
          </div>
          <FormAlert tone="success" message={notice} testId="add-to-cart-notice" />
        </div>
      </div>
    </article>
  )
}
