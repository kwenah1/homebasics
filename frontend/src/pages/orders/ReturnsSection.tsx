import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '../../api/client'
import type { Order } from '../../api/orders'
import { REASON_LABEL, RETURN_STATUS_LABEL, returnApi, useOrderReturns } from '../../api/returns'
import type { ReturnReason } from '../../api/returns'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' })

/** RET-01..04 on the order page: what can still be returned, the request form, and the
 *  status of each return. */
export function ReturnsSection({ order }: { order: Order }) {
  const everDelivered = order.delivered_at !== null
  const { data: returns } = useOrderReturns(order.order_number, everDelivered)
  const [open, setOpen] = useState(false)

  if (!everDelivered) return null
  const window = order.return_window

  return (
    <section aria-label="Returns" className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5" data-testid="order-returns">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Returns</h2>
        {window.can_return && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50"
            data-testid="return-start"
          >
            Return items
          </button>
        )}
      </div>
      {window.return_by && (
        <p className="text-sm text-stone-600" data-testid="return-by">
          {window.status === 'open'
            ? `You can return items until ${day(window.return_by)}.`
            : window.status === 'closed'
              ? `The return window closed on ${day(window.return_by)}.`
              : 'Everything on this order has been returned or is being returned.'}
        </p>
      )}
      {open && <ReturnForm order={order} onDone={() => setOpen(false)} />}
      {returns && returns.length > 0 && (
        <ul className="divide-y divide-stone-100" data-testid="return-list">
          {returns.map((r) => (
            <ReturnRow key={r.return_number} orderNumber={order.order_number} ret={r} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ReturnRow({ orderNumber, ret }: { orderNumber: string; ret: import('../../api/returns').ReturnRequest }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const cancel = async () => {
    setError(null)
    try {
      await returnApi.cancel(ret.return_number)
      await queryClient.invalidateQueries({ queryKey: ['returns', orderNumber] })
      await queryClient.invalidateQueries({ queryKey: ['order', orderNumber] })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel the return.')
    }
  }
  return (
    <li className="space-y-1 py-3 text-sm" data-testid="return-row" data-return={ret.return_number} data-status={ret.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{ret.return_number}</span>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium" data-testid="return-status">
          {RETURN_STATUS_LABEL[ret.status]}
        </span>
      </div>
      <p className="text-stone-600">
        {ret.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')} · {REASON_LABEL[ret.reason]}
      </p>
      {ret.staff_note && <p className="text-stone-600">Note from us: {ret.staff_note}</p>}
      {ret.refund_cents !== null && (
        <p className="text-violet-900" data-testid="return-refund">
          Refunded {formatCents(ret.refund_cents)}
        </p>
      )}
      {ret.can_cancel && (
        <button type="button" onClick={cancel} className="text-brand-700 underline" data-testid="return-cancel">
          Cancel this return
        </button>
      )}
      <FormAlert message={error} />
    </li>
  )
}

function ReturnForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [reason, setReason] = useState<ReturnReason | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const chosen = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => ({ product_id: Number(id), quantity: q }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chosen.length) return setError('Choose at least one item to return.')
    if (!reason) return setError('Tell us why you are returning it.')
    setError(null)
    setSending(true)
    try {
      await returnApi.create(order.order_number, { items: chosen, reason, ...(note.trim() ? { note: note.trim() } : {}) })
      await queryClient.invalidateQueries({ queryKey: ['returns', order.order_number] })
      await queryClient.invalidateQueries({ queryKey: ['order', order.order_number] })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not send your request. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-stone-50 p-4" data-testid="return-form" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What are you returning?</legend>
        {order.return_window.returnable.map((item) => (
          <label key={item.product_id} className="flex items-center justify-between gap-3 text-sm">
            <span>{item.product_name}</span>
            <select
              value={quantities[item.product_id] ?? 0}
              onChange={(e) => setQuantities({ ...quantities, [item.product_id]: Number(e.target.value) })}
              aria-label={`Quantity of ${item.product_name} to return`}
              className="rounded-lg border border-stone-300 px-2 py-1"
              data-testid={`return-qty-${item.sku}`}
            >
              {Array.from({ length: item.quantity + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ReturnReason)}
          className="block w-full rounded-lg border border-stone-300 px-3 py-2"
          data-testid="return-reason"
        >
          <option value="">Choose a reason…</option>
          {Object.entries(REASON_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Anything we should know? (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="block w-full rounded-lg border border-stone-300 px-3 py-2"
          data-testid="return-note"
        />
      </label>
      <p className="text-xs text-stone-500">
        You'll be refunded what you paid for the items, including tax and your share of any discount. Shipping isn't
        refunded.
      </p>
      <FormAlert message={error} testId="return-error" />
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={sending}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60"
          data-testid="return-submit"
        >
          {sending ? 'Sending…' : 'Request return'}
        </button>
        <button type="button" onClick={onDone} className="text-sm underline">
          Never mind
        </button>
      </div>
    </form>
  )
}
