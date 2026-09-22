import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { adminApi } from '../../api/admin'
import type { AdjustReason } from '../../api/admin'
import { ApiError } from '../../api/client'
import { FormAlert } from '../../components/form'
import { dollarsToCents, formatCents } from '../../lib/money'

const input = 'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm'
const button = 'rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60'

function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fields : {}
}

export function AdminProducts() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const archived = params.get('archived') ?? 'all'
  const [search, setSearch] = useState(q)
  const { data, isPending, isError } = useQuery({
    queryKey: ['admin', 'products', q, archived],
    queryFn: () => adminApi.products({ q, archived, page: 1 }),
  })

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setParams(new URLSearchParams({ ...(search ? { q: search } : {}), ...(archived !== 'all' ? { archived } : {}) }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        <Link to="/admin/products/new" className={button} data-testid="admin-new-product">
          New product
        </Link>
      </div>
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3" aria-label="Filter products">
        <label className="text-sm">
          Search name or SKU
          <input className={input} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="admin-product-search" />
        </label>
        <label className="text-sm">
          Show
          <select
            className={input}
            value={archived}
            data-testid="admin-product-archived"
            onChange={(e) => setParams(new URLSearchParams({ ...(q ? { q } : {}), archived: e.target.value }))}
          >
            <option value="all">All</option>
            <option value="active">On sale</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button type="submit" className={button}>
          Search
        </button>
      </form>
      {isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {isError && <FormAlert message="Couldn't load products." />}
      {data && (
        <table className="w-full rounded-xl bg-white text-sm" data-testid="admin-products">
          <thead className="text-left text-stone-600">
            <tr>
              <th className="p-2">SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th className="text-right">Price</th>
              <th className="text-right">Stock</th>
              <th className="p-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id} className="border-t border-stone-100" data-testid="admin-product-row" data-sku={p.sku}>
                <td className="p-2 font-mono">{p.sku}</td>
                <td>
                  <Link to={`/admin/products/${p.id}`} className="underline">
                    {p.name}
                  </Link>
                </td>
                <td>{p.category_name}</td>
                <td className="text-right">{formatCents(p.price_cents)}</td>
                <td className="text-right" data-testid="admin-product-stock">
                  {p.stock_qty}
                </td>
                <td className="p-2 text-right">{p.is_archived ? 'Archived' : 'On sale'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <p className="text-xs text-stone-500">{data.total} products</p>}
    </div>
  )
}

export function AdminProductNew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: categories = [] } = useQuery({ queryKey: ['admin', 'categories'], queryFn: adminApi.categories })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const price = dollarsToCents(String(form.get('price')))
    if (price === undefined) return setErrors({ price_cents: 'Enter a price like 4.99.' })
    setSaving(true)
    setErrors({})
    setMessage(null)
    try {
      const product = await adminApi.createProduct({
        category_id: Number(form.get('category_id')),
        sku: String(form.get('sku')),
        name: String(form.get('name')),
        description: String(form.get('description') ?? ''),
        price_cents: price,
        initial_stock: Number(form.get('initial_stock') || 0),
      })
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      navigate(`/admin/products/${product.id}?created=1`)
    } catch (err) {
      setErrors(fieldErrors(err))
      setMessage(err instanceof ApiError ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const error = (name: string) =>
    errors[name] && (
      <span className="mt-1 block text-sm text-red-700" data-testid={`admin-error-${name}`}>
        {errors[name]}
      </span>
    )

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4 rounded-2xl border border-stone-200 bg-white p-6" aria-label="New product">
      <h1 className="text-2xl font-bold tracking-tight">New product</h1>
      <FormAlert message={message} testId="admin-product-error" />
      <label className="block text-sm">
        Category
        <select name="category_id" className={input} required data-testid="admin-product-category">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {error('category_id')}
      </label>
      <label className="block text-sm">
        SKU
        <input name="sku" className={input} placeholder="KIT-011" data-testid="admin-product-sku" />
        {error('sku')}
      </label>
      <label className="block text-sm">
        Name
        <input name="name" className={input} data-testid="admin-product-name" />
        {error('name')}
      </label>
      <label className="block text-sm">
        Description
        <textarea name="description" className={input} rows={3} data-testid="admin-product-description" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Price ($)
          <input name="price" className={input} inputMode="decimal" data-testid="admin-product-price" />
          {error('price_cents')}
        </label>
        <label className="block text-sm">
          Starting stock
          <input name="initial_stock" type="number" min={0} defaultValue={0} className={input} data-testid="admin-product-stock-input" />
          {error('initial_stock')}
        </label>
      </div>
      <button type="submit" disabled={saving} className={button} data-testid="admin-product-save">
        {saving ? 'Saving…' : 'Create product'}
      </button>
    </form>
  )
}

export function AdminProductDetail() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const productId = Number(id)
  const queryClient = useQueryClient()
  const product = useQuery({ queryKey: ['admin', 'product', productId], queryFn: () => adminApi.product(productId) })
  const ledger = useQuery({ queryKey: ['admin', 'ledger', productId], queryFn: () => adminApi.ledger(productId) })
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    params.get('created') ? { ok: true, text: 'Product created and on sale.' } : null,
  )
  const [reason, setReason] = useState<AdjustReason>('restock')

  if (product.isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (product.isError) return <FormAlert message="Product not found." />
  const p = product.data

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin'] })
    await queryClient.invalidateQueries({ queryKey: ['product'] })
  }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setNotice(null)
    try {
      await fn()
      await refresh()
      setNotice({ ok: true, text: ok })
    } catch (err) {
      const fields = fieldErrors(err)
      setNotice({ ok: false, text: Object.values(fields)[0] ?? (err instanceof ApiError ? err.message : 'Failed.') })
    }
  }

  const saveDetails = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const price = dollarsToCents(String(form.get('price')))
    if (price === undefined) return setNotice({ ok: false, text: 'Enter a price like 4.99.' })
    return run(
      () => adminApi.updateProduct(p.id, { name: String(form.get('name')), description: String(form.get('description')), price_cents: price }),
      'Saved.',
    )
  }

  const adjust = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const amount = Math.abs(Number(form.get('amount')))
    const direction = reason === 'damaged' ? -1 : reason === 'restock' ? 1 : Number(form.get('direction'))
    return run(
      () => adminApi.adjustStock(p.id, { delta: direction * amount, reason, note: String(form.get('note') ?? '') || undefined }),
      'Stock updated.',
    ).then(() => e.currentTarget?.reset())
  }

  return (
    <div className="space-y-6" data-testid="admin-product" data-sku={p.sku}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
          <p className="text-sm text-stone-600">
            <span className="font-mono">{p.sku}</span> · {p.category_name} ·{' '}
            {p.is_archived ? 'Archived' : (
              <Link to={`/p/${p.slug}`} className="underline" data-testid="admin-view-in-store">
                View in store
              </Link>
            )}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100"
          data-testid="admin-archive-toggle"
          onClick={() => run(() => adminApi.setArchived(p.id, !p.is_archived), p.is_archived ? 'Back on sale.' : 'Archived: hidden from the store.')}
        >
          {p.is_archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
      {notice && <FormAlert tone={notice.ok ? 'success' : 'error'} message={notice.text} testId="admin-notice" />}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveDetails} key={p.updated_at} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Product details">
          <h2 className="font-semibold">Details</h2>
          <label className="block text-sm">
            Name
            <input name="name" defaultValue={p.name} className={input} data-testid="admin-edit-name" />
          </label>
          <label className="block text-sm">
            Description
            <textarea name="description" defaultValue={p.description} rows={3} className={input} />
          </label>
          <label className="block text-sm">
            Price ($)
            <input name="price" defaultValue={(p.price_cents / 100).toFixed(2)} className={input} data-testid="admin-edit-price" />
          </label>
          <button type="submit" className={button} data-testid="admin-save-details">
            Save
          </button>
        </form>

        <form onSubmit={adjust} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Adjust stock">
          <h2 className="font-semibold">
            Stock: <span data-testid="admin-stock-qty">{p.stock_qty}</span>
          </h2>
          <label className="block text-sm">
            Reason
            <select className={input} value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)} data-testid="admin-adjust-reason">
              <option value="restock">Restock (add)</option>
              <option value="damaged">Damaged (remove)</option>
              <option value="adjustment">Count correction</option>
            </select>
          </label>
          {reason === 'adjustment' && (
            <label className="block text-sm">
              Direction
              <select name="direction" className={input} data-testid="admin-adjust-direction">
                <option value="1">Add</option>
                <option value="-1">Remove</option>
              </select>
            </label>
          )}
          <label className="block text-sm">
            Units
            <input name="amount" type="number" min={1} required className={input} data-testid="admin-adjust-amount" />
          </label>
          <label className="block text-sm">
            Note (optional)
            <input name="note" className={input} data-testid="admin-adjust-note" />
          </label>
          <button type="submit" className={button} data-testid="admin-adjust-submit">
            Update stock
          </button>
        </form>
      </div>

      <section aria-labelledby="ledger" className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 id="ledger" className="mb-2 font-semibold">
          Stock history
        </h2>
        {ledger.data && (
          <>
            <p className="mb-2 text-xs text-stone-500" data-testid="admin-ledger-check">
              Ledger total {ledger.data.ledger_total} {ledger.data.ledger_total === ledger.data.stock_qty ? '= stock ✓' : `≠ stock ${ledger.data.stock_qty}`}
            </p>
            <table className="w-full text-sm" data-testid="admin-ledger">
              <thead className="text-left text-stone-600">
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Reason</th>
                  <th>By / order</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.movements.map((m) => (
                  <tr key={m.id} className="border-t border-stone-100" data-testid="admin-ledger-row">
                    <td className="py-1">{new Date(m.created_at).toLocaleString()}</td>
                    <td className={m.delta < 0 ? 'text-red-700' : 'text-emerald-800'}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    <td>{m.reason.replace('_', ' ')}</td>
                    <td>{m.order_number ?? m.actor_email ?? '-'}</td>
                    <td>{m.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  )
}
