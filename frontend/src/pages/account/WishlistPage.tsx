import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { useWishlist, wishlistApi } from '../../api/wishlist'
import { ProductImage, StockBadge } from '../../components/catalog'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'

/** WSH-01..04: saved products with today's price and stock. */
export function WishlistPage() {
  const { data, isPending, isError } = useWishlist(true)
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (isError) return <FormAlert message="We couldn't load your wishlist." />

  const run = async (productId: number, action: () => Promise<unknown>, ok: string) => {
    setBusy(productId)
    setMessage(null)
    try {
      await action()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
        queryClient.invalidateQueries({ queryKey: ['cart'] }),
      ])
      setMessage({ ok: true, text: ok })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Your wishlist</h1>
        <p className="text-sm text-stone-500" data-testid="wishlist-count">
          {data.count} of {data.limit} saved
        </p>
      </div>
      {message && <FormAlert tone={message.ok ? 'success' : undefined} message={message.text} testId="wishlist-message" />}
      {data.items.length === 0 ? (
        <p data-testid="wishlist-empty">
          Nothing saved yet.{' '}
          <Link to="/products" className="font-medium text-brand-700 underline">
            Browse products
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white" data-testid="wishlist-items">
          {data.items.map(({ product, available }) => (
            <li
              key={product.id}
              className={`flex flex-wrap items-center gap-4 p-4 ${available ? '' : 'opacity-60'}`}
              data-testid="wishlist-item"
              data-sku={product.sku}
            >
              <div className="w-16 shrink-0">
                <ProductImage slug={product.category.slug} name={product.name} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {available ? (
                  <Link to={`/p/${product.slug}`} className="font-medium hover:underline">
                    {product.name}
                  </Link>
                ) : (
                  <span className="font-medium">{product.name}</span>
                )}
                <p className="text-sm">
                  {available ? formatCents(product.price_cents) : <span data-testid="wishlist-unavailable">No longer sold</span>}
                </p>
                {available && <StockBadge status={product.stock_status} left={product.stock_left} />}
              </div>
              <div className="flex gap-2">
                {available && (
                  <button
                    type="button"
                    disabled={busy === product.id || product.stock_status === 'out_of_stock'}
                    onClick={() => run(product.id, () => wishlistApi.moveToCart(product.id), `Moved ${product.name} to your cart.`)}
                    className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60"
                    data-testid="wishlist-move"
                  >
                    Move to cart
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy === product.id}
                  onClick={() => run(product.id, () => wishlistApi.remove(product.id), `Removed ${product.name}.`)}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-60"
                  data-testid="wishlist-remove"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
