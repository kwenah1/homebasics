import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import { useWishlist, wishlistApi } from '../api/wishlist'
import { useAuth } from '../auth/AuthContext'

/** WSH-01: save / unsave. Signed-out shoppers are sent to sign in and brought back. */
export function WishlistButton({ productId }: { productId: number }) {
  const { status } = useAuth()
  const signedIn = status === 'authenticated'
  const { data } = useWishlist(signedIn)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saved = data?.items.some((i) => i.product.id === productId) ?? false

  const toggle = async () => {
    if (!signedIn) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (saved) {
        await wishlistApi.remove(productId)
        await queryClient.invalidateQueries({ queryKey: ['wishlist'] })
      } else {
        queryClient.setQueryData(['wishlist'], await wishlistApi.add(productId))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update your wishlist.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || status === 'loading'}
        aria-pressed={signedIn ? saved : undefined}
        data-testid="wishlist-toggle"
        data-saved={saved ? 'true' : 'false'}
        className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-60"
      >
        <span aria-hidden="true" className={saved ? 'text-rose-600' : 'text-stone-400'}>
          {saved ? '♥' : '♡'}
        </span>{' '}
        {saved ? 'Saved' : 'Save'}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700" data-testid="wishlist-error">
          {error}
        </p>
      )}
    </div>
  )
}
