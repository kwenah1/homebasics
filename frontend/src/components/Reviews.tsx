import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { ApiError } from '../api/client'
import { reviewApi } from '../api/reviews'
import type { Review } from '../api/reviews'
import { useAuth } from '../auth/AuthContext'
import { FormAlert } from './form'

const PAGE = 5
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' })

function Stars({ value, label }: { value: number; label?: string }) {
  return (
    <span className="text-amber-600" aria-label={label ?? `${value} out of 5 stars`} role="img">
      {'★'.repeat(value)}
      <span className="text-stone-300">{'★'.repeat(5 - value)}</span>
    </span>
  )
}

/** REV-01..05 on the product page: summary, breakdown, the list, and the shopper's own review. */
export function ReviewsSection({ slug }: { slug: string }) {
  const [shown, setShown] = useState(PAGE)
  const { data, isPending, isError } = useQuery({
    queryKey: ['reviews', slug, shown],
    queryFn: () => reviewApi.list(slug, 1, shown),
    placeholderData: (previous) => previous,
  })

  return (
    <section aria-labelledby="reviews-heading" className="space-y-4 border-t border-stone-200 pt-6" data-testid="reviews">
      <h2 id="reviews-heading" className="text-xl font-semibold">
        Reviews
      </h2>
      {isPending && <p className="text-sm text-stone-500">Loading reviews…</p>}
      {isError && <FormAlert message="We couldn't load the reviews." />}
      {data && (
        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <div className="space-y-2" data-testid="review-summary">
            {data.rating_avg !== null ? (
              <p className="text-3xl font-bold">
                {data.rating_avg.toFixed(1)} <span className="text-base font-normal text-stone-500">out of 5</span>
              </p>
            ) : (
              <p className="text-stone-600">No ratings yet.</p>
            )}
            <p className="text-sm text-stone-500">
              <span data-testid="rating-count" data-count={data.rating_count}>
                {data.rating_count} rating{data.rating_count === 1 ? '' : 's'}
              </span>{' '}
              · {data.total} written review
              {data.total === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1 text-sm" aria-label="Written reviews by star rating">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = data.distribution[String(stars)] ?? 0
                const pct = data.total ? Math.round((n / data.total) * 100) : 0
                return (
                  <li key={stars} className="flex items-center gap-2" data-testid={`dist-${stars}`}>
                    <span className="w-10">{stars} ★</span>
                    <span className="h-2 flex-1 rounded-full bg-stone-100" aria-hidden="true">
                      <span className="block h-2 rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-6 text-right text-stone-500">{n}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="space-y-4">
            <MyReviewBox slug={slug} />
            {data.items.length === 0 ? (
              <p className="text-sm text-stone-600" data-testid="reviews-empty">
                No written reviews yet.
              </p>
            ) : (
              <ul className="space-y-4" data-testid="review-list">
                {data.items.map((r) => (
                  <ReviewItem key={r.id} review={r} />
                ))}
              </ul>
            )}
            {data.total > data.items.length && (
              <button
                type="button"
                onClick={() => setShown(shown + PAGE)}
                className="text-sm font-medium text-brand-700 underline"
                data-testid="reviews-more"
              >
                Show more reviews
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function ReviewItem({ review }: { review: Review }) {
  return (
    <li className="space-y-1" data-testid="review">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stars value={review.rating} />
        {review.title && <span className="font-semibold">{review.title}</span>}
      </div>
      <p className="text-xs text-stone-500">
        {review.author} · {day(review.created_at)}
        {review.verified_purchase && <span className="ml-1 text-emerald-800">· Verified purchase</span>}
      </p>
      {review.body && <p className="whitespace-pre-line text-sm text-stone-700">{review.body}</p>}
    </li>
  )
}

function MyReviewBox({ slug }: { slug: string }) {
  const { status } = useAuth()
  const location = useLocation()
  const signedIn = status === 'authenticated'
  const mine = useQuery({
    queryKey: ['review-mine', slug],
    queryFn: () => reviewApi.mine(slug),
    enabled: signedIn,
  })
  const [editing, setEditing] = useState(false)

  if (status === 'anonymous') {
    return (
      <p className="text-sm text-stone-600">
        <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="font-medium text-brand-700 underline">
          Sign in
        </Link>{' '}
        to review products you've bought.
      </p>
    )
  }
  if (!mine.data) return null
  if (mine.data.review && !editing) {
    return (
      <div className="space-y-2 rounded-xl bg-stone-50 p-4" data-testid="my-review">
        <p className="text-sm font-medium">Your review</p>
        <ReviewItemInline review={mine.data.review} />
        <button type="button" onClick={() => setEditing(true)} className="text-sm text-brand-700 underline" data-testid="review-edit">
          Edit your review
        </button>
      </div>
    )
  }
  if (mine.data.can_review || editing) {
    return <ReviewForm slug={slug} existing={mine.data.review} onDone={() => setEditing(false)} />
  }
  return (
    <p className="text-sm text-stone-600" data-testid="review-not-eligible">
      You can review this product once an order of it has been delivered.
    </p>
  )
}

function ReviewItemInline({ review }: { review: Review }) {
  return (
    <div className="space-y-1 text-sm">
      <Stars value={review.rating} />
      {review.title && <p className="font-semibold">{review.title}</p>}
      {review.body && <p className="whitespace-pre-line text-stone-700">{review.body}</p>}
    </div>
  )
}

function ReviewForm({ slug, existing, onDone }: { slug: string; existing: Review | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reviews', slug] }),
      queryClient.invalidateQueries({ queryKey: ['review-mine', slug] }),
      queryClient.invalidateQueries({ queryKey: ['product', slug] }),
    ])
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating < 1) return setError('Choose a star rating.')
    setError(null)
    setSaving(true)
    try {
      const input = { rating, title, body }
      await (existing ? reviewApi.update(slug, input) : reviewApi.create(slug, input))
      await refresh()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your review. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await reviewApi.remove(slug)
      await refresh()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not delete your review.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-stone-50 p-4" data-testid="review-form" noValidate>
      <fieldset>
        <legend className="text-sm font-medium">{existing ? 'Edit your review' : 'Write a review'}</legend>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Your rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer text-2xl" title={`${n} star${n === 1 ? '' : 's'}`}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
                data-testid={`review-star-${n}`}
              />
              <span aria-hidden="true" className={n <= rating ? 'text-amber-500' : 'text-stone-300'}>
                ★
              </span>
              <span className="sr-only">
                {n} star{n === 1 ? '' : 's'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Title (optional)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          className="block w-full rounded-lg border border-stone-300 px-3 py-2"
          data-testid="review-title"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Your review (optional)</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          className="block w-full rounded-lg border border-stone-300 px-3 py-2"
          data-testid="review-body"
        />
      </label>
      <FormAlert message={error} testId="review-error" />
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60"
          data-testid="review-submit"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Post review'}
        </button>
        {existing && (
          <>
            <button type="button" onClick={onDone} className="text-sm underline">
              Cancel
            </button>
            <button type="button" onClick={remove} disabled={saving} className="text-sm text-red-700 underline" data-testid="review-delete">
              Delete review
            </button>
          </>
        )}
      </div>
    </form>
  )
}
