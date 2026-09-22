import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAddresses } from '../../api/addresses'
import { ApiError } from '../../api/client'
import { orderApi } from '../../api/orders'
import { useCart } from '../../cart/CartContext'
import type { ShippingMethod } from '../../api/orders'
import { FormAlert } from '../../components/form'
import { newIdempotencyKey } from '../../lib/card'
import { shouldKeepKey } from '../../lib/idempotency'
import { formatCents, formatRate } from '../../lib/money'

const METHOD_LABEL: Record<ShippingMethod, string> = {
  standard: 'Standard (3-5 business days)',
  express: 'Express (1-2 business days)',
}

type Problem = { sku: string; issue: string; requested: number; available: number }

export function CheckoutPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: addresses, isPending: addressesLoading } = useAddresses()
  const [chosenId, setChosenId] = useState<number | null>(null)
  const [method, setMethod] = useState<ShippingMethod>('standard')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<{ text: string; lines?: Problem[] } | null>(null)
  // One key per "attempt to place this order". Kept across retries after a network error;
  // replaced after any definitive answer (see shouldKeepKey).
  const idempotencyKey = useRef(newIdempotencyKey())

  const addressId = chosenId ?? addresses?.find((a) => a.is_default)?.id ?? addresses?.[0]?.id ?? null
  // Regression (found by E2E): right after sign-in the guest cart is still being merged. The
  // quote used to be fetched before the merge finished (showing an empty cart) and was never
  // refreshed. Wait for the cart, and key the quote on its contents so any change re-quotes.
  const { cart, isLoading: cartLoading } = useCart()
  const cartVersion = cart ? `${cart.item_count}:${cart.subtotal_cents}` : null
  const quote = useQuery({
    queryKey: ['quote', addressId, method, cartVersion],
    queryFn: () => orderApi.quote(addressId!, method),
    enabled: addressId !== null && !cartLoading && cartVersion !== null,
  })

  if (addressesLoading) return <p className="text-sm text-stone-500">Loading…</p>

  if (!addresses?.length) {
    return (
      <div className="space-y-3" data-testid="checkout-no-address">
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p>Add a shipping address to your account first.</p>
        <Link to="/account" className="font-medium text-brand-700 underline">
          Go to your address book
        </Link>
      </div>
    )
  }

  const placeOrder = async () => {
    if (!quote.data || addressId === null) return
    setError(null)
    setPlacing(true)
    try {
      const order = await orderApi.place(
        { address_id: addressId, shipping_method: method, expected_total_cents: quote.data.total_cents },
        idempotencyKey.current,
      )
      queryClient.setQueryData(['cart', 'account'], undefined)
      await queryClient.invalidateQueries({ queryKey: ['cart'] })
      navigate(`/orders/${order.order_number}/pay`)
    } catch (e) {
      if (!shouldKeepKey(e)) idempotencyKey.current = newIdempotencyKey()
      if (e instanceof ApiError && e.code === 'total_changed') {
        await quote.refetch()
        setError({ text: 'Your total changed since you opened this page. Please check it and place your order again.' })
      } else if (e instanceof ApiError && e.code === 'cart_has_issues') {
        setError({ text: e.message, lines: (e.error as unknown as { lines: Problem[] }).lines })
      } else {
        setError({ text: e instanceof ApiError ? e.message : 'We could not reach the store. Please try again.' })
      }
    } finally {
      setPlacing(false)
    }
  }

  const q = quote.data

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <fieldset className="space-y-2 rounded-2xl border border-stone-200 bg-white p-5">
            <legend className="px-1 text-lg font-semibold">Ship to</legend>
            {addresses.map((a) => (
              <label key={a.id} className="flex cursor-pointer gap-3 rounded-lg p-2 hover:bg-stone-50" data-testid="checkout-address">
                <input
                  type="radio"
                  name="address"
                  checked={a.id === addressId}
                  onChange={() => setChosenId(a.id)}
                  data-testid={`address-option-${a.id}`}
                />
                <span className="text-sm">
                  <span className="font-medium">{a.label}</span> - {a.recipient_name}, {a.line1}, {a.city}, {a.state}{' '}
                  {a.postal_code}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2 rounded-2xl border border-stone-200 bg-white p-5">
            <legend className="px-1 text-lg font-semibold">Shipping</legend>
            {(q?.shipping_options ?? []).map((o) => (
              <label key={o.method} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg p-2 hover:bg-stone-50">
                <span className="flex items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="shipping"
                    checked={method === o.method}
                    onChange={() => setMethod(o.method)}
                    data-testid={`shipping-${o.method}`}
                  />
                  {METHOD_LABEL[o.method]}
                </span>
                <span className="text-sm font-medium" data-testid={`shipping-${o.method}-price`}>
                  {o.cents === 0 ? 'Free' : formatCents(o.cents)}
                </span>
              </label>
            ))}
          </fieldset>

          {q && (
            <section aria-label="Items" className="rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="mb-2 text-lg font-semibold">Items ({q.item_count})</h2>
              <ul className="divide-y divide-stone-100 text-sm" data-testid="checkout-lines">
                {q.lines.map((line) => (
                  <li key={line.product_id} className="flex justify-between py-2">
                    <span>
                      {line.name} × {line.quantity}
                    </span>
                    <span>{formatCents(line.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="h-fit space-y-3 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Order total">
          {quote.isPending && <p className="text-sm text-stone-500">Calculating…</p>}
          {quote.isError && <FormAlert message="We couldn't calculate your total." />}
          {q && (
            <dl className="space-y-2 text-sm" data-testid="checkout-summary">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd data-testid="summary-subtotal">{formatCents(q.subtotal_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>
                  Tax ({q.tax_state} {formatRate(q.tax_rate)})
                </dt>
                <dd data-testid="summary-tax">{formatCents(q.tax_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Shipping</dt>
                <dd data-testid="summary-shipping">{q.shipping_cents === 0 ? 'Free' : formatCents(q.shipping_cents)}</dd>
              </div>
              <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd data-testid="summary-total">{formatCents(q.total_cents)}</dd>
              </div>
            </dl>
          )}
          {q && !q.can_place_order && (
            <p className="text-sm text-red-700" data-testid="checkout-blocked">
              {q.blocking_reason}{' '}
              <Link to="/cart" className="underline">
                Review your cart
              </Link>
            </p>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="checkout-error">
              {error.text}
              {error.lines && (
                <ul className="mt-1 list-disc pl-5" data-testid="checkout-problem-lines">
                  {error.lines.map((l) => (
                    <li key={l.sku}>
                      {l.sku}: {l.available === 0 ? 'no longer available' : `only ${l.available} left (you asked for ${l.requested})`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={placeOrder}
            disabled={!q?.can_place_order || placing || quote.isFetching}
            aria-busy={placing || undefined}
            data-testid="place-order"
            className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {placing ? 'Placing order…' : q ? `Place order - ${formatCents(q.total_cents)}` : 'Place order'}
          </button>
          <p className="text-xs text-stone-500">You'll have 30 minutes to pay once the order is placed.</p>
        </aside>
      </div>
    </div>
  )
}
