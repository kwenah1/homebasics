import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useProduct } from '../../api/catalog'
import { ApiError } from '../../api/client'
import { useCart } from '../../cart/CartContext'
import { CartLimitError } from '../../cart/guestCart'
import { ProductImage, Rating, StockBadge } from '../../components/catalog'
import { FormAlert } from '../../components/form'
import { ReviewsSection } from '../../components/Reviews'
import { WishlistButton } from '../../components/WishlistButton'
import { formatCents } from '../../lib/money'
import { NotFoundPage } from '../NotFoundPage'

export function ProductDetailPage() {
  const { slug = '' } = useParams()
  const { data: product, isPending, isError, error } = useProduct(slug)
  const { add, cart, mode } = useCart()
  // Regression (found by E2E): while the session was still being restored, Add went into the
  // guest cart, so the item only merged into the account later - after prices could change.
  const sessionPending = mode === 'loading'
  const [qty, setQty] = useState(1)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [adding, setAdding] = useState(false)

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
  const inCart = cart?.items.find((i) => i.product_id === product.id)?.quantity ?? 0

  const onAdd = async () => {
    setResult(null)
    setAdding(true)
    try {
      await add(product, qty)
      setResult({ ok: true, text: `Added ${qty} to your cart.` })
    } catch (e) {
      const message =
        e instanceof CartLimitError || e instanceof ApiError ? e.message : 'Could not add to cart.'
      setResult({ ok: false, text: message })
    } finally {
      setAdding(false)
    }
  }

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
              disabled={soldOut || adding || sessionPending}
              aria-busy={adding || undefined}
              data-testid="add-to-cart"
              onClick={onAdd}
              className="flex-1 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {soldOut ? 'Out of stock' : adding ? 'Adding…' : 'Add to cart'}
            </button>
            <WishlistButton productId={product.id} />
          </div>
          {inCart > 0 && (
            <p className="text-sm text-stone-600" data-testid="in-cart">
              {inCart} already in your cart.
            </p>
          )}
          {result && (
            <div
              role={result.ok ? 'status' : 'alert'}
              data-testid={result.ok ? 'add-to-cart-success' : 'add-to-cart-error'}
              className={`rounded-lg border px-3 py-2 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}
            >
              {result.text}{' '}
              {result.ok && (
                <Link to="/cart" className="font-medium underline" data-testid="view-cart">
                  View cart
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <ReviewsSection slug={product.slug} />
    </article>
  )
}
