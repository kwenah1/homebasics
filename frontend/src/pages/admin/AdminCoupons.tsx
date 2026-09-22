import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { adminApi } from '../../api/admin'
import type { Coupon, CouponInput } from '../../api/admin'
import { ApiError } from '../../api/client'
import { FormAlert } from '../../components/form'
import { formatCents } from '../../lib/money'

const STATE_STYLE: Record<Coupon['state'], string> = {
  active: 'bg-emerald-100 text-emerald-900',
  scheduled: 'bg-sky-100 text-sky-900',
  expired: 'bg-stone-200 text-stone-700',
  exhausted: 'bg-amber-100 text-amber-900',
  disabled: 'bg-stone-200 text-stone-700',
}

const toCents = (dollars: FormDataEntryValue | null) => Math.round(Number(dollars || 0) * 100)
// <input type="datetime-local"> gives local time without a zone; the API needs one.
const toIso = (local: FormDataEntryValue | null) => (local ? new Date(String(local)).toISOString() : null)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

function describeCoupon(c: Pick<Coupon, 'kind' | 'percent_off' | 'amount_off_cents' | 'min_subtotal_cents'>) {
  const off = c.kind === 'percent' ? `${c.percent_off}% off` : `${formatCents(c.amount_off_cents ?? 0)} off`
  return c.min_subtotal_cents ? `${off} orders of ${formatCents(c.min_subtotal_cents)}+` : off
}

/** ADM-05: create coupons, see their uses and state, switch them on and off. */
export function AdminCoupons() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: ['admin', 'coupons'], queryFn: adminApi.coupons })
  const [notice, setNotice] = useState<{ ok: boolean; text: string; fields?: Record<string, string> } | null>(null)
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent')

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setNotice(null)
    try {
      await fn()
      await queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] })
      setNotice({ ok: true, text: ok })
      return true
    } catch (e) {
      setNotice({
        ok: false,
        text: e instanceof ApiError ? e.message : 'Failed.',
        fields: e instanceof ApiError ? e.fields : undefined,
      })
      return false
    }
  }

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const body: Partial<CouponInput> = {
      code: String(f.get('code') ?? '').trim(),
      description: String(f.get('description') ?? '').trim(),
      kind,
      ...(kind === 'percent' ? { percent_off: Number(f.get('percent_off')) } : { amount_off_cents: toCents(f.get('amount_off')) }),
      min_subtotal_cents: toCents(f.get('min_subtotal')),
      per_user_limit: Number(f.get('per_user_limit') || 1),
      ...(f.get('max_redemptions') ? { max_redemptions: Number(f.get('max_redemptions')) } : {}),
      ...(f.get('starts_at') ? { starts_at: toIso(f.get('starts_at')) } : {}),
      ...(f.get('expires_at') ? { expires_at: toIso(f.get('expires_at')) } : {}),
    }
    if (await run(() => adminApi.createCoupon(body), `Created ${body.code?.toUpperCase()}.`)) form.reset()
  }

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>

  const input = 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2'
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Coupons</h1>
      {notice && (
        <FormAlert
          tone={notice.ok ? 'success' : 'error'}
          message={[notice.text, ...Object.entries(notice.fields ?? {}).map(([k, v]) => `${k}: ${v}`)].join(' ')}
          testId="admin-notice"
        />
      )}
      <form onSubmit={create} className="grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-3" aria-label="New coupon" data-testid="coupon-form">
        <label className="text-sm">
          Code
          <input name="code" required minLength={3} maxLength={20} pattern="[A-Za-z0-9-]+" className={`${input} uppercase`} data-testid="coupon-code" />
        </label>
        <label className="text-sm sm:col-span-2">
          Description (shown to shoppers)
          <input name="description" maxLength={200} className={input} data-testid="coupon-description" />
        </label>
        <fieldset className="text-sm">
          <legend>Discount</legend>
          <div className="mt-1 flex gap-3">
            <label className="flex items-center gap-1">
              <input type="radio" name="kind" checked={kind === 'percent'} onChange={() => setKind('percent')} data-testid="coupon-kind-percent" />
              Percent
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="kind" checked={kind === 'fixed'} onChange={() => setKind('fixed')} data-testid="coupon-kind-fixed" />
              Fixed amount
            </label>
          </div>
        </fieldset>
        {kind === 'percent' ? (
          <label className="text-sm">
            Percent off
            <input name="percent_off" type="number" required min={1} max={100} className={input} data-testid="coupon-percent" />
          </label>
        ) : (
          <label className="text-sm">
            Amount off ($)
            <input name="amount_off" type="number" required min={0.01} step={0.01} className={input} data-testid="coupon-amount" />
          </label>
        )}
        <label className="text-sm">
          Minimum spend ($)
          <input name="min_subtotal" type="number" min={0} step={0.01} defaultValue={0} className={input} data-testid="coupon-min" />
        </label>
        <label className="text-sm">
          Uses per customer
          <input name="per_user_limit" type="number" min={1} max={100} defaultValue={1} className={input} data-testid="coupon-per-user" />
        </label>
        <label className="text-sm">
          Total uses (blank = unlimited)
          <input name="max_redemptions" type="number" min={1} className={input} data-testid="coupon-max" />
        </label>
        <span />
        <label className="text-sm">
          Starts (optional)
          <input name="starts_at" type="datetime-local" className={input} data-testid="coupon-starts" />
        </label>
        <label className="text-sm">
          Expires (optional)
          <input name="expires_at" type="datetime-local" className={input} data-testid="coupon-expires" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white" data-testid="coupon-create">
            Create coupon
          </button>
        </div>
      </form>

      <table className="w-full rounded-xl bg-white text-sm" data-testid="admin-coupons">
        <thead className="text-left text-stone-600">
          <tr>
            <th className="p-2">Code</th>
            <th>Discount</th>
            <th>Window</th>
            <th className="text-right">Uses</th>
            <th>State</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id} className="border-t border-stone-100" data-testid="admin-coupon-row" data-code={c.code}>
              <td className="p-2 font-mono font-semibold">{c.code}</td>
              <td>
                {describeCoupon(c)}
                <span className="block text-xs text-stone-500">{c.per_user_limit} per customer</span>
              </td>
              <td className="text-xs">
                {day(c.starts_at)} → {day(c.expires_at)}
              </td>
              <td className="text-right" data-testid="coupon-uses">
                {c.uses}
                {c.max_redemptions !== null && ` / ${c.max_redemptions}`}
              </td>
              <td>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.state]}`} data-testid="coupon-state">
                  {c.state}
                </span>
              </td>
              <td className="p-2 text-right">
                <button
                  type="button"
                  onClick={() => run(() => adminApi.updateCoupon(c.id, { is_active: !c.is_active }), `${c.code} ${c.is_active ? 'disabled' : 'enabled'}.`)}
                  className="underline"
                  data-testid="coupon-toggle"
                >
                  {c.is_active ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
