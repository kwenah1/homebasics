import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { CartLine, MergeReport } from '../../api/cart'
import { ApiError } from '../../api/client'
import { useCart } from '../../cart/CartContext'
import { ProductImage, StockBadge } from '../../components/catalog'
import { formatCents } from '../../lib/money'

function issueText(line: CartLine): string | null {
  switch (line.issue) {
    case 'unavailable':
      return 'No longer sold - please remove it.'
    case 'out_of_stock':
      return 'Sold out since you added it.'
    case 'insufficient_stock':
      return `Only ${line.available} available - lower the quantity.`
    default:
      return null
  }
}

function PriceChange({ line }: { line: CartLine }) {
  if (!line.price_change_cents) return null
  const up = line.price_change_cents > 0
  return (
    <p data-testid="line-price-change" data-direction={up ? 'up' : 'down'} className={`text-xs ${up ? 'text-amber-800' : 'text-emerald-800'}`}>
      Price {up ? 'went up' : 'dropped'} from {formatCents(line.price_when_added_cents)} to{' '}
      {formatCents(line.unit_price_cents)}
    </p>
  )
}

function MergeNotice({ report, onDismiss }: { report: MergeReport; onDismiss: () => void }) {
  return (
    <div role="status" data-testid="merge-report" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-medium">We added the items from before you signed in.</p>
      <ul className="mt-1 list-disc pl-5">
        {report.capped.length > 0 && (
          <li data-testid="merge-capped">
            {report.capped.length} item{report.capped.length === 1 ? ' was' : 's were'} reduced to the most you can
            buy (10 per item, or what's in stock).
          </li>
        )}
        {report.skipped.length > 0 && (
          <li data-testid="merge-skipped">
            {report.skipped.length} item{report.skipped.length === 1 ? " isn't" : " aren't"} available any more and
            {report.skipped.length === 1 ? ' was' : ' were'} left out.
          </li>
        )}
      </ul>
      <button type="button" onClick={onDismiss} className="mt-2 font-medium underline" data-testid="merge-dismiss">
        OK
      </button>
    </div>
  )
}

function CartRow({ line }: { line: CartLine }) {
  const { setQuantity, remove } = useCart()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const problem = issueText(line)
  // Offer every quantity the shopper may pick now, but keep their current one selectable
  // even if stock has fallen below it (so the select still shows the truth).
  const options = Math.max(line.max_order_qty, line.quantity)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li data-testid="cart-line" data-sku={line.sku} data-issue={line.issue ?? ''} className="flex gap-4 py-4">
      <Link to={`/p/${line.slug}`} className="w-24 shrink-0" tabIndex={-1} aria-hidden="true">
        <ProductImage slug={line.category.slug} name={line.name} />
      </Link>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/p/${line.slug}`} className="font-medium hover:underline" data-testid="line-name">
            {line.name}
          </Link>
          <span className="font-semibold" data-testid="line-total">
            {formatCents(line.line_total_cents)}
          </span>
        </div>
        <p className="text-sm text-stone-600" data-testid="line-unit-price">
          {formatCents(line.unit_price_cents)} each
        </p>
        <PriceChange line={line} />
        {problem ? (
          <p className="text-sm font-medium text-red-700" data-testid="line-issue">
            {problem}
          </p>
        ) : (
          <div>
            <StockBadge status={line.stock_status} left={line.stock_left} />
          </div>
        )}
        <div className="mt-1 flex items-center gap-4">
          <label className="text-sm">
            <span className="sr-only">Quantity for {line.name}</span>
            <select
              value={line.quantity}
              disabled={busy || line.issue === 'unavailable' || line.issue === 'out_of_stock'}
              onChange={(e) => run(() => setQuantity(line.product_id, Number(e.target.value)))}
              data-testid="line-qty"
              className="rounded-lg border border-stone-300 bg-white px-2 py-1 disabled:opacity-50"
            >
              {Array.from({ length: Math.max(1, options) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n} disabled={n > line.max_order_qty && n !== line.quantity}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => remove(line.product_id))}
            data-testid="line-remove"
            aria-label={`Remove ${line.name}`}
            className="text-sm font-medium text-red-700 underline disabled:opacity-50"
          >
            Remove
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700" data-testid="line-error">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

export function CartPage() {
  const {
    cart,
    isLoading,
    mode,
    acknowledgePrices,
    mergeReport,
    dismissMergeReport,
    mergeFailed,
    retryMerge,
  } = useCart()

  if (isLoading || !cart) {
    return (
      <p className="text-sm text-stone-500" data-testid="cart-loading">
        Loading your cart…
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>
      {mergeReport && <MergeNotice report={mergeReport} onDismiss={dismissMergeReport} />}
      {mergeFailed && (
        <div role="alert" data-testid="merge-failed" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          We couldn't move the items you added before signing in.{' '}
          <button type="button" className="font-medium underline" onClick={retryMerge}>
            Try again
          </button>
        </div>
      )}

      {cart.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center" data-testid="cart-empty">
          <p className="font-medium">Your cart is empty.</p>
          <Link to="/products" className="mt-3 inline-block font-medium text-brand-700 underline">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <section aria-label="Items">
            {cart.has_price_changes && (
              <div role="status" data-testid="price-change-notice" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Some prices changed since you added these items. Your total uses today's prices.
                <button type="button" onClick={() => acknowledgePrices()} className="font-medium underline" data-testid="acknowledge-prices">
                  OK, got it
                </button>
              </div>
            )}
            <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4" data-testid="cart-lines">
              {cart.items.map((line) => (
                <CartRow key={line.product_id} line={line} />
              ))}
            </ul>
          </section>

          <aside className="h-fit space-y-3 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Order summary">
            <div className="flex justify-between text-sm">
              <span>Items</span>
              <span data-testid="cart-item-count">{cart.item_count}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Subtotal</span>
              <span data-testid="cart-subtotal">{formatCents(cart.subtotal_cents)}</span>
            </div>
            <p className="text-sm" data-testid="free-shipping">
              {cart.amount_to_free_shipping_cents > 0 ? (
                <>
                  Add <strong>{formatCents(cart.amount_to_free_shipping_cents)}</strong> more for free standard
                  shipping.
                </>
              ) : (
                <span className="text-emerald-800">Your order qualifies for free standard shipping.</span>
              )}
            </p>
            <p className="text-xs text-stone-500">Tax and shipping are calculated at checkout.</p>
            {cart.has_issues && (
              <p className="text-sm text-red-700" data-testid="cart-has-issues">
                Fix the items marked above to continue.
              </p>
            )}
            <button
              type="button"
              disabled
              data-testid="checkout"
              className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Checkout (coming in Milestone 5)
            </button>
            {mode === 'guest' && (
              <p className="text-xs text-stone-600" data-testid="guest-hint">
                <Link to="/login?next=%2Fcart" className="underline">
                  Sign in
                </Link>{' '}
                to save your cart to your account.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
