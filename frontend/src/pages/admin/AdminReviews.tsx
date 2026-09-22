import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { adminApi } from '../../api/admin'
import { ApiError } from '../../api/client'
import { Pagination } from '../../components/catalog'
import { FormAlert } from '../../components/form'

/** ADM-06: newest reviews first; remove abusive ones (the product's rating is recalculated). */
export function AdminReviews() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const { data, isPending } = useQuery({ queryKey: ['admin', 'reviews', page], queryFn: () => adminApi.reviews(page) })
  const [confirm, setConfirm] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const remove = async (id: number, slug: string) => {
    setNotice(null)
    try {
      await adminApi.deleteReview(id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['reviews', slug] }),
        queryClient.invalidateQueries({ queryKey: ['product', slug] }),
      ])
      setNotice({ ok: true, text: 'Review removed.' })
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Failed.' })
    } finally {
      setConfirm(null)
    }
  }

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
      {notice && <FormAlert tone={notice.ok ? 'success' : 'error'} message={notice.text} testId="admin-notice" />}
      {data?.items.length === 0 && <p className="text-sm text-stone-600">No reviews yet.</p>}
      <ul className="space-y-3" data-testid="admin-reviews">
        {data?.items.map((r) => (
          <li key={r.id} className="space-y-1 rounded-xl bg-white p-4 text-sm" data-testid="admin-review" data-review={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="text-amber-600" aria-label={`${r.rating} out of 5 stars`}>
                  {'★'.repeat(r.rating)}
                </span>{' '}
                on{' '}
                <Link to={`/p/${r.product_slug}`} className="underline">
                  {r.product_name}
                </Link>
              </span>
              <span className="text-xs text-stone-500">
                {r.author} · {r.author_email}
              </span>
            </div>
            {r.title && <p className="font-semibold">{r.title}</p>}
            {r.body && <p className="whitespace-pre-line text-stone-700">{r.body}</p>}
            {confirm === r.id ? (
              <span className="flex gap-3">
                Remove this review?
                <button type="button" onClick={() => remove(r.id, r.product_slug)} className="font-semibold text-red-700 underline" data-testid="admin-review-confirm">
                  Yes, remove
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="underline">
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm(r.id)} className="text-red-700 underline" data-testid="admin-review-delete">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {data && data.total > data.page_size && (
        <Pagination page={page} pages={Math.ceil(data.total / data.page_size)} onPage={setPage} />
      )}
    </div>
  )
}
