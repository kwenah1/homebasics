import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { adminApi } from '../../api/admin'
import { ApiError } from '../../api/client'
import { REASON_LABEL, RETURN_STATUS_LABEL } from '../../api/returns'
import type { AdminReturn, ReturnStatus } from '../../api/returns'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'

const FILTERS: (ReturnStatus | '')[] = ['requested', 'approved', 'received', 'rejected', 'cancelled', '']

/** ADM-07: decide returns (approve / reject with a reason) and receive the goods. */
export function AdminReturns() {
  const [status, setStatus] = useState<ReturnStatus | ''>('requested')
  // Page level, not in the card: a decided return leaves the filtered list, and its
  // confirmation must not vanish with it (found by E2E).
  const [done, setDone] = useState<string | null>(null)
  const { data, isPending } = useQuery({
    queryKey: ['admin', 'returns', status],
    queryFn: () => adminApi.returns(status || undefined),
  })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Returns</h1>
      <label className="text-sm">
        Show{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value as ReturnStatus | '')} className="rounded-lg border border-stone-300 px-2 py-1" data-testid="returns-filter">
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f ? RETURN_STATUS_LABEL[f] : 'All'}
            </option>
          ))}
        </select>
      </label>
      <FormAlert tone="success" message={done} testId="admin-returns-done" />
      {isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-stone-600" data-testid="returns-empty">
          Nothing here.
        </p>
      )}
      <ul className="space-y-3" data-testid="admin-returns">
        {data?.map((r) => (
          <ReturnCard key={r.return_number} ret={r} onDone={setDone} />
        ))}
      </ul>
    </div>
  )
}

function ReturnCard({ ret, onDone }: { ret: AdminReturn; onDone: (text: string) => void }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [restock, setRestock] = useState(ret.reason !== 'damaged')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<AdminReturn>, ok: (r: AdminReturn) => string) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await fn()
      onDone(`${ret.return_number}: ${ok(updated)}`)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'returns'] })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 rounded-xl bg-white p-4 text-sm" data-testid="admin-return" data-return={ret.return_number} data-status={ret.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{ret.return_number}</span> for{' '}
          <Link to={`/admin/orders/${ret.order_number}`} className="underline">
            {ret.order_number}
          </Link>{' '}
          · {ret.customer_name} ({ret.customer_email})
        </span>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium">{RETURN_STATUS_LABEL[ret.status]}</span>
      </div>
      <p>
        {ret.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')} · {formatCents(ret.value_cents)} at list price
      </p>
      <p className="text-stone-600">
        Reason: {REASON_LABEL[ret.reason]}
        {ret.note && ` - “${ret.note}”`}
      </p>
      {ret.staff_note && <p className="text-stone-600">Staff note: {ret.staff_note}</p>}
      {ret.refund_cents !== null && (
        <p className="text-violet-900" data-testid="admin-return-refund">
          Refunded {formatCents(ret.refund_cents)} · {ret.restocked ? 'restocked' : 'not restocked'}
        </p>
      )}
      {(ret.status === 'requested' || ret.status === 'approved') && (
        <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-2">
          <label className="min-w-48 flex-1">
            Note to the customer
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5"
              data-testid="return-staff-note"
            />
          </label>
          {ret.status === 'requested' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => adminApi.approveReturn(ret.return_number, note || undefined), () => 'Approved.')}
              className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
              data-testid="return-approve"
            >
              Approve
            </button>
          )}
          {ret.status === 'approved' && (
            <>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} data-testid="return-restock" />
                Put back in stock
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    () => adminApi.receiveReturn(ret.return_number, restock, note || undefined),
                    (r) => `Received - refunded ${formatCents(r.refund_cents ?? 0)}.`,
                  )
                }
                className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                data-testid="return-receive"
              >
                Mark received &amp; refund
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy || !note.trim()}
            title={note.trim() ? undefined : 'Add a note explaining why'}
            onClick={() => act(() => adminApi.rejectReturn(ret.return_number, note.trim()), () => 'Rejected.')}
            className="rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-800 disabled:opacity-60"
            data-testid="return-reject"
          >
            Reject
          </button>
        </div>
      )}
      <FormAlert message={error} testId="admin-return-error" />
    </li>
  )
}
