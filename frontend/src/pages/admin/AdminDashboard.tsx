import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { adminApi } from '../../api/admin'
import { STATUS_LABEL } from '../../api/orders'
import type { OrderStatus } from '../../api/orders'
import { FormAlert } from '../../components/form'

export function AdminDashboard() {
  const { data, isPending, isError } = useQuery({ queryKey: ['admin', 'summary'], queryFn: adminApi.summary })
  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (isError) return <FormAlert message="Couldn't load the dashboard." />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <section aria-label="Orders by status" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="awaiting-fulfilment">
          <p className="text-xs uppercase text-amber-900">To fulfil</p>
          <p className="text-2xl font-bold">{data.awaiting_fulfilment}</p>
        </div>
        {(Object.entries(data.orders_by_status) as [OrderStatus, number][]).map(([status, count]) => (
          <Link
            key={status}
            to={`/admin/orders?status=${status}`}
            className="rounded-xl border border-stone-200 bg-white p-4 hover:border-brand-500"
            data-testid={`status-count-${status}`}
          >
            <p className="text-xs uppercase text-stone-600">{STATUS_LABEL[status]}</p>
            <p className="text-2xl font-bold">{count}</p>
          </Link>
        ))}
      </section>

      <section aria-labelledby="low-stock" className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 id="low-stock" className="mb-3 font-semibold">
          Low stock (5 or fewer)
        </h2>
        {data.low_stock.length === 0 ? (
          <p className="text-sm text-stone-600">Everything is well stocked.</p>
        ) : (
          <table className="w-full text-sm" data-testid="low-stock">
            <thead className="text-left text-stone-600">
              <tr>
                <th className="py-1">SKU</th>
                <th>Product</th>
                <th className="text-right">In stock</th>
              </tr>
            </thead>
            <tbody>
              {data.low_stock.map((p) => (
                <tr key={p.id} className="border-t border-stone-100" data-sku={p.sku}>
                  <td className="py-1 font-mono">{p.sku}</td>
                  <td>
                    <Link to={`/admin/products/${p.id}`} className="underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className={`text-right font-semibold ${p.stock_qty === 0 ? 'text-red-700' : ''}`}>{p.stock_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
