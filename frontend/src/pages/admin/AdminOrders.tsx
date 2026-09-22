import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { adminApi } from '../../api/admin'
import { ApiError } from '../../api/client'
import { STATUS_LABEL } from '../../api/orders'
import type { OrderStatus } from '../../api/orders'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'
import { StatusBadge } from '../orders/OrderPages'

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  processing: 'Start processing',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
  refunded: 'Refund',
}

export function AdminOrders() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'orders', status, q],
    queryFn: () => adminApi.orders({ status, q }),
  })

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setParams(new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}) }))
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" aria-label="Filter orders">
        <label className="text-sm">
          Status
          <select
            value={status}
            data-testid="admin-order-status-filter"
            onChange={(e) => setParams(new URLSearchParams({ ...(e.target.value ? { status: e.target.value } : {}), ...(q ? { q } : {}) }))}
            className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2"
          >
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Order number or email
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 block rounded-lg border border-stone-300 px-3 py-2" data-testid="admin-order-search" />
        </label>
        <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {isError && <FormAlert message="Couldn't load orders." />}
      {data && (
        <table className="w-full rounded-xl bg-white text-sm" data-testid="admin-orders">
          <thead className="text-left text-stone-600">
            <tr>
              <th className="p-2">Order</th>
              <th>Customer</th>
              <th>Placed</th>
              <th>Status</th>
              <th className="p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((o) => (
              <tr key={o.order_number} className="border-t border-stone-100" data-testid="admin-order-row" data-order={o.order_number}>
                <td className="p-2">
                  <Link to={`/admin/orders/${o.order_number}`} className="font-mono underline">
                    {o.order_number}
                  </Link>
                </td>
                <td>{o.customer_email}</td>
                <td>{new Date(o.placed_at).toLocaleString()}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td className="p-2 text-right">{formatCents(o.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.items.length === 0 && <p data-testid="admin-orders-empty">No orders match.</p>}
    </div>
  )
}

export function AdminOrderDetail() {
  const { orderNumber = '' } = useParams()
  const queryClient = useQueryClient()
  const { data: order, isPending, isError } = useQuery({
    queryKey: ['admin', 'order', orderNumber],
    queryFn: () => adminApi.order(orderNumber),
  })
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<OrderStatus | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (isError) return <FormAlert message="Order not found." />

  const act = async (to: OrderStatus) => {
    setNotice(null)
    setPending(to)
    try {
      const next = to === 'refunded' ? await adminApi.refund(orderNumber, note || undefined) : await adminApi.setStatus(orderNumber, to, note || undefined)
      queryClient.setQueryData(['admin', 'order', orderNumber], next)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'summary'] })
      setNote('')
      setNotice({ ok: true, text: `Order is now ${STATUS_LABEL[next.status].toLowerCase()}.` })
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Failed.' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-5" data-testid="admin-order" data-order={order.order_number}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order {order.order_number}</h1>
          <p className="text-sm text-stone-600" data-testid="admin-order-customer">
            {order.customer_name} · {order.customer_email}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {notice && <FormAlert tone={notice.ok ? 'success' : 'error'} message={notice.text} testId="admin-notice" />}

      {order.next_statuses.length > 0 && (
        <section aria-label="Actions" className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4">
          <label className="text-sm">
            Note for the history (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="mt-1 block w-64 rounded-lg border border-stone-300 px-3 py-2" data-testid="admin-order-note" />
          </label>
          {order.next_statuses.map((to) => (
            <button
              key={to}
              type="button"
              disabled={pending !== null}
              onClick={() => act(to)}
              data-testid={`admin-order-action-${to}`}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${to === 'cancelled' || to === 'refunded' ? 'border border-red-300 text-red-800 hover:bg-red-50' : 'bg-brand-700 text-white hover:bg-brand-900'}`}
            >
              {ACTION_LABEL[to] ?? STATUS_LABEL[to]}
            </button>
          ))}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Items" className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
          <ul className="divide-y divide-stone-100">
            {order.items.map((i) => (
              <li key={i.product_id} className="flex justify-between py-1">
                <span>
                  <span className="font-mono text-xs">{i.sku}</span> {i.product_name} × {i.quantity}
                </span>
                <span>{formatCents(i.line_total_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right font-semibold" data-testid="admin-order-total">
            Total {formatCents(order.total_cents)}
          </p>
          <ul className="mt-2 text-xs text-stone-600" data-testid="admin-order-payments">
            {order.payments.map((p, i) => (
              <li key={i}>
                {p.status} {formatCents(p.amount_cents)} (card ••{p.card_last4}){p.failure_reason ? ` - ${p.failure_reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="History" className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
          <ol className="space-y-1" data-testid="admin-order-history">
            {order.history.map((h, i) => (
              <li key={i}>
                <span className="font-medium">{STATUS_LABEL[h.to_status]}</span>{' '}
                <span className="text-stone-500">{new Date(h.at).toLocaleString()}</span>
                {h.note && <span> - {h.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
