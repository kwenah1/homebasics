import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { orderApi, STATUS_LABEL, useOrder } from '../../api/orders'
import type { OrderStatus } from '../../api/orders'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'
import { NotFoundPage } from '../NotFoundPage'
import { ReturnsSection } from './ReturnsSection'

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending_payment: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-900',
  processing: 'bg-sky-100 text-sky-900',
  shipped: 'bg-indigo-100 text-indigo-900',
  delivered: 'bg-emerald-100 text-emerald-900',
  cancelled: 'bg-stone-200 text-stone-800',
  expired: 'bg-stone-200 text-stone-800',
  refunded: 'bg-violet-100 text-violet-900',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span data-testid="order-status" data-status={status} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function OrdersPage() {
  const { data, isPending, isError } = useQuery({ queryKey: ['orders'], queryFn: () => orderApi.list() })
  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (isError) return <FormAlert message="We couldn't load your orders." />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Your orders</h1>
      {data.items.length === 0 ? (
        <p data-testid="orders-empty">
          No orders yet.{' '}
          <Link to="/products" className="font-medium text-brand-700 underline">
            Start shopping
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white" data-testid="orders-list">
          {data.items.map((o) => (
            <li key={o.order_number} data-testid="order-row" data-order={o.order_number}>
              <Link to={`/orders/${o.order_number}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-stone-50">
                <span>
                  <span className="font-medium">{o.order_number}</span>
                  <span className="block text-xs text-stone-500">
                    {when(o.placed_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={o.status} />
                  <span className="font-semibold">{formatCents(o.total_cents)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OrderDetailPage() {
  const { orderNumber = '' } = useParams()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const { data: order, isPending, isError, error } = useOrder(orderNumber)
  const [confirming, setConfirming] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  if (isError && error instanceof ApiError && error.status === 404) return <NotFoundPage />
  if (isError) return <FormAlert message="We couldn't load this order." />
  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>

  const cancel = async () => {
    setCancelError(null)
    setCancelling(true)
    try {
      queryClient.setQueryData(['order', orderNumber], await orderApi.cancel(orderNumber))
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      setConfirming(false)
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Could not cancel the order.')
    } finally {
      setCancelling(false)
    }
  }

  const refunds = order.payments.filter((p) => p.status === 'refunded')

  return (
    <div className="space-y-6" data-testid="order-detail" data-order={order.order_number}>
      {params.get('paid') === '1' && order.status === 'paid' && (
        <FormAlert tone="success" testId="order-thanks" message={`Thank you! Your payment went through and order ${order.order_number} is confirmed.`} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order {order.order_number}</h1>
          <p className="text-sm text-stone-500">Placed {when(order.placed_at)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="flex flex-wrap gap-3">
        {order.can_pay && (
          <Link to={`/orders/${order.order_number}/pay`} data-testid="order-pay" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900">
            Pay now
          </Link>
        )}
        {order.can_cancel &&
          (confirming ? (
            <span className="flex items-center gap-2 text-sm" role="group" aria-label="Confirm cancellation">
              Cancel this order{order.status !== 'pending_payment' ? ' and refund your payment' : ''}?
              <button type="button" onClick={cancel} disabled={cancelling} data-testid="order-cancel-confirm" className="rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
                Yes, cancel
              </button>
              <button type="button" onClick={() => setConfirming(false)} data-testid="order-cancel-keep" className="underline">
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} data-testid="order-cancel" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50">
              Cancel order
            </button>
          ))}
      </div>
      <FormAlert message={cancelError} testId="order-cancel-error" />
      {refunds.map((r, i) => (
        <p key={i} className="text-sm text-violet-900" data-testid="order-refund">
          Refunded {formatCents(r.amount_cents)} to card ending {r.card_last4}.
        </p>
      ))}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Items" className="rounded-2xl border border-stone-200 bg-white p-5">
          <ul className="divide-y divide-stone-100 text-sm" data-testid="order-items">
            {order.items.map((i) => (
              <li key={i.product_id} className="flex justify-between gap-3 py-2">
                <span>
                  {i.product_name} <span className="text-stone-500">× {i.quantity}</span>
                </span>
                <span>{formatCents(i.line_total_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
        <aside className="space-y-4">
          <dl className="space-y-1 rounded-2xl border border-stone-200 bg-white p-5 text-sm" data-testid="order-totals">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCents(order.subtotal_cents)}</dd></div>
            {order.discount_cents > 0 && (
              <div className="flex justify-between text-green-800">
                <dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt>
                <dd data-testid="order-discount">−{formatCents(order.discount_cents)}</dd>
              </div>
            )}
            <div className="flex justify-between"><dt>Tax</dt><dd data-testid="order-tax">{formatCents(order.tax_cents)}</dd></div>
            <div className="flex justify-between"><dt>Shipping</dt><dd>{order.shipping_cents ? formatCents(order.shipping_cents) : 'Free'}</dd></div>
            <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold"><dt>Total</dt><dd data-testid="order-total">{formatCents(order.total_cents)}</dd></div>
          </dl>
          <address className="rounded-2xl border border-stone-200 bg-white p-5 text-sm not-italic" data-testid="order-ship-to">
            <span className="font-medium">Ship to</span>
            <br />
            {order.ship_to.name}
            <br />
            {order.ship_to.line1}
            {order.ship_to.line2 && (<><br />{order.ship_to.line2}</>)}
            <br />
            {order.ship_to.city}, {order.ship_to.state} {order.ship_to.postal_code}
          </address>
        </aside>
      </div>

      <ReturnsSection order={order} />

      <section aria-label="Order history" className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="mb-2 font-semibold">History</h2>
        <ol className="space-y-1 text-sm" data-testid="order-history">
          {order.history.map((h, i) => (
            <li key={i} data-status={h.to_status}>
              <span className="font-medium">{STATUS_LABEL[h.to_status]}</span>{' '}
              <span className="text-stone-500">{when(h.at)}</span>
              {h.note && <span className="text-stone-600"> - {h.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
