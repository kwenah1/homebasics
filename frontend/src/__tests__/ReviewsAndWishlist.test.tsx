import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { Review } from '../api/reviews'
import { EMPTY_CART } from '../api/cart'
import { detail, product } from '../test/catalogFixtures'
import { renderApp } from '../test/render'
import { apiError, EMPTY_REVIEWS, server, signedIn } from '../test/server'

const pan = detail()
const URL = `/api/v1/products/${pan.slug}`

const review = (overrides: Partial<Review> = {}): Review => ({
  id: 1,
  rating: 5,
  title: 'Great pan',
  body: 'Heats evenly.',
  author: 'Riley P.',
  verified_purchase: true,
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  ...overrides,
})

function productServer() {
  server.use(http.get(URL, () => HttpResponse.json(pan)))
}

describe('Reviews on the product page (REV)', () => {
  it('shows the summary, the star breakdown and the reviews', async () => {
    productServer()
    server.use(
      http.get(`${URL}/reviews`, () =>
        HttpResponse.json({
          ...EMPTY_REVIEWS,
          items: [review(), review({ id: 2, rating: 3, title: null, author: 'Sam K.' })],
          total: 2,
          rating_avg: 4.2,
          rating_count: 37,
          distribution: { '1': 0, '2': 0, '3': 1, '4': 0, '5': 1 },
        }),
      ),
    )
    renderApp(`/p/${pan.slug}`)
    const summary = await screen.findByTestId('review-summary')
    expect(summary).toHaveTextContent('4.2 out of 5')
    expect(summary).toHaveTextContent('37 ratings · 2 written reviews')
    expect(screen.getByTestId('dist-5')).toHaveTextContent('1')
    const items = screen.getAllByTestId('review')
    expect(items[0]).toHaveTextContent('Great pan')
    expect(items[0]).toHaveTextContent('Riley P.')
    expect(items[0]).toHaveTextContent('Verified purchase')
    expect(within(items[1]).getByRole('img')).toHaveAccessibleName('3 out of 5 stars')
  })

  it('invites signed-out visitors to sign in', async () => {
    productServer()
    renderApp(`/p/${pan.slug}`)
    const reviews = await screen.findByTestId('reviews')
    expect(await within(reviews).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(`/p/${pan.slug}`)}`,
    )
  })

  it('explains who can review', async () => {
    productServer()
    server.use(...signedIn())
    renderApp(`/p/${pan.slug}`)
    expect(await screen.findByTestId('review-not-eligible')).toHaveTextContent('once an order of it has been delivered')
  })

  it('an eligible shopper posts a review', async () => {
    productServer()
    const posted: unknown[] = []
    server.use(
      ...signedIn(),
      http.get(`${URL}/reviews/mine`, () =>
        HttpResponse.json(
          posted.length
            ? { can_review: false, reason: 'already_reviewed', review: review({ rating: 4 }) }
            : { can_review: true, reason: null, review: null },
        ),
      ),
      http.post(`${URL}/reviews`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json(review({ rating: 4 }), { status: 201 })
      }),
    )
    renderApp(`/p/${pan.slug}`)
    await userEvent.click(await screen.findByTestId('review-submit'))
    expect(await screen.findByTestId('review-error')).toHaveTextContent('Choose a star rating')
    await userEvent.click(screen.getByTestId('review-star-4'))
    await userEvent.type(screen.getByTestId('review-title'), 'Solid')
    await userEvent.click(screen.getByTestId('review-submit'))
    expect(await screen.findByTestId('my-review')).toBeInTheDocument()
    expect(posted).toEqual([{ rating: 4, title: 'Solid', body: '' }])
  })

  it('a server refusal is shown', async () => {
    productServer()
    server.use(
      ...signedIn(),
      http.get(`${URL}/reviews/mine`, () => HttpResponse.json({ can_review: true, reason: null, review: null })),
      http.post(`${URL}/reviews`, () =>
        apiError(409, 'review_exists', "You've already reviewed this product - edit your review."),
      ),
    )
    renderApp(`/p/${pan.slug}`)
    await userEvent.click(await screen.findByTestId('review-star-5'))
    await userEvent.click(screen.getByTestId('review-submit'))
    expect(await screen.findByTestId('review-error')).toHaveTextContent('already reviewed')
  })

  it('edit and delete my review', async () => {
    productServer()
    const calls: string[] = []
    server.use(
      ...signedIn(),
      http.get(`${URL}/reviews/mine`, () =>
        HttpResponse.json({ can_review: false, reason: 'already_reviewed', review: review({ rating: 2 }) }),
      ),
      http.patch(`${URL}/reviews/mine`, async ({ request }) => {
        calls.push(`PATCH ${JSON.stringify(await request.json())}`)
        return HttpResponse.json(review({ rating: 3 }))
      }),
      http.delete(`${URL}/reviews/mine`, () => {
        calls.push('DELETE')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp(`/p/${pan.slug}`)
    await userEvent.click(await screen.findByTestId('review-edit'))
    await userEvent.click(screen.getByTestId('review-star-3'))
    await userEvent.click(screen.getByTestId('review-submit'))
    await waitFor(() => expect(calls[0]).toContain('"rating":3'))
    await userEvent.click(await screen.findByTestId('review-edit'))
    await userEvent.click(screen.getByTestId('review-delete'))
    await waitFor(() => expect(calls).toContain('DELETE'))
  })
})

describe('Wishlist (WSH)', () => {
  it('signed-out Save goes to sign in and back', async () => {
    productServer()
    renderApp(`/p/${pan.slug}`)
    await userEvent.click(await screen.findByTestId('wishlist-toggle'))
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('saves and unsaves from the product page', async () => {
    productServer()
    let saved = false
    server.use(
      ...signedIn(),
      http.get('/api/v1/me/wishlist', () =>
        HttpResponse.json({ items: saved ? [{ product: pan, added_at: '', available: true }] : [], count: 0, limit: 50 }),
      ),
      http.put(`/api/v1/me/wishlist/${pan.id}`, () => {
        saved = true
        return HttpResponse.json({ items: [{ product: pan, added_at: '', available: true }], count: 1, limit: 50 })
      }),
      http.delete(`/api/v1/me/wishlist/${pan.id}`, () => {
        saved = false
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp(`/p/${pan.slug}`)
    const button = await screen.findByTestId('wishlist-toggle')
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
    await userEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
  })

  it('wishlist page: move to cart, a refusal keeps it, archived items are marked', async () => {
    const soap = product({ id: 5, sku: 'CLN-002', name: 'Dish Soap', slug: 'dish-soap' })
    const gone = product({ id: 6, sku: 'OLD-001', name: 'Old Lamp', slug: 'old-lamp' })
    server.use(
      ...signedIn(),
      http.get('/api/v1/me/wishlist', () =>
        HttpResponse.json({
          items: [
            { product: soap, added_at: '', available: true },
            { product: gone, added_at: '', available: false },
          ],
          count: 2,
          limit: 50,
        }),
      ),
      http.post('/api/v1/me/wishlist/5/move-to-cart', () =>
        apiError(409, 'quantity_limit', 'You can have at most 10 of this item in your cart.'),
      ),
      http.get('/api/v1/cart', () => HttpResponse.json(EMPTY_CART)),
    )
    renderApp('/wishlist')
    const rows = await screen.findAllByTestId('wishlist-item')
    expect(within(rows[1]).getByTestId('wishlist-unavailable')).toHaveTextContent('No longer sold')
    expect(within(rows[1]).queryByTestId('wishlist-move')).not.toBeInTheDocument()
    await userEvent.click(within(rows[0]).getByTestId('wishlist-move'))
    expect(await screen.findByTestId('wishlist-message')).toHaveTextContent('at most 10')
    expect(screen.getByTestId('wishlist-count')).toHaveTextContent('2 of 50 saved')
  })

  it('empty wishlist', async () => {
    server.use(...signedIn())
    renderApp('/wishlist')
    expect(await screen.findByTestId('wishlist-empty')).toBeInTheDocument()
  })
})
