import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'

import { cartApi, EMPTY_CART } from '../api/cart'
import type { Cart, GuestLine, MergeReport } from '../api/cart'
import { useAuth } from '../auth/AuthContext'
import { addToGuestLines, readGuestCart, subscribeGuestCart, writeGuestCart } from './guestCart'

type Mode = 'loading' | 'guest' | 'account'

export interface AddableProduct {
  id: number
  price_cents: number
  max_order_qty: number
}

interface CartState {
  mode: Mode
  cart: Cart | undefined
  isLoading: boolean
  itemCount: number
  add: (product: AddableProduct, quantity: number) => Promise<void>
  setQuantity: (productId: number, quantity: number) => Promise<void>
  remove: (productId: number) => Promise<void>
  clear: () => Promise<void>
  acknowledgePrices: () => Promise<void>
  /** What happened when the guest cart was merged at sign-in (shown once on the cart page). */
  mergeReport: MergeReport | null
  dismissMergeReport: () => void
  /** The guest cart couldn't be moved into the account; it is kept for a retry. */
  mergeFailed: boolean
  retryMerge: () => void
}

const CartContext = createContext<CartState | null>(null)
const ACCOUNT_KEY = ['cart', 'account']

export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const queryClient = useQueryClient()
  const mode: Mode =
    status === 'loading' ? 'loading' : status === 'authenticated' ? 'account' : 'guest'
  const guestLines = useSyncExternalStore(subscribeGuestCart, readGuestCart, readGuestCart)
  const [mergeReport, setMergeReport] = useState<MergeReport | null>(null)
  const [mergeFailed, setMergeFailed] = useState(false)
  const [mergeAttempt, setMergeAttempt] = useState(0)
  const merging = useRef(false)

  // --- Merge the guest cart into the account right after sign-in (CRT-02) ---------------
  const needsMerge = mode === 'account' && guestLines.length > 0
  useEffect(() => {
    if (!needsMerge || merging.current) return // ref guard: StrictMode runs effects twice
    merging.current = true
    cartApi
      .merge(readGuestCart())
      .then(({ cart, report }) => {
        // Clear only once the server has the items (nothing lost on failure), and clear
        // before anything else could re-send them (no double-counted merge).
        writeGuestCart([])
        queryClient.setQueryData(ACCOUNT_KEY, cart)
        setMergeFailed(false)
        if (report.capped.length || report.skipped.length) setMergeReport(report)
      })
      .catch(() => setMergeFailed(true))
      .finally(() => {
        merging.current = false
      })
  }, [needsMerge, mergeAttempt, queryClient])

  // --- Data ---------------------------------------------------------------------------
  const account = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: cartApi.get,
    enabled: mode === 'account' && (!needsMerge || mergeFailed),
  })
  const guest = useQuery({
    queryKey: ['cart', 'guest', guestLines],
    queryFn: () => cartApi.preview(guestLines),
    enabled: mode === 'guest' && guestLines.length > 0,
    placeholderData: keepPreviousData,
  })

  // Signed out: drop the account cart from memory so the next visitor can't see it.
  useEffect(() => {
    if (mode === 'guest') queryClient.removeQueries({ queryKey: ACCOUNT_KEY })
  }, [mode, queryClient])

  // Products that no longer exist are pruned from the guest cart.
  const unknown = guest.data?.unknown_product_ids
  useEffect(() => {
    if (unknown?.length) {
      writeGuestCart(readGuestCart().filter((l) => !unknown.includes(l.product_id)))
    }
  }, [unknown])

  const cart =
    mode === 'account'
      ? account.data
      : mode === 'guest'
        ? guestLines.length
          ? guest.data
          : EMPTY_CART
        : undefined
  const itemCount =
    mode === 'guest'
      ? guestLines.reduce((n, l) => n + l.quantity, 0)
      : (account.data?.item_count ?? 0)

  // --- Actions ------------------------------------------------------------------------
  const setAccountCart = useCallback(
    (next: Cart) => queryClient.setQueryData(ACCOUNT_KEY, next),
    [queryClient],
  )

  const value = useMemo<CartState>(() => {
    const guestUpdate = (fn: (lines: GuestLine[]) => GuestLine[]) =>
      writeGuestCart(fn(readGuestCart()))
    return {
      mode,
      cart,
      isLoading:
        mode === 'loading' ||
        (mode === 'account' ? account.isPending : guest.isPending && guestLines.length > 0),
      itemCount,
      mergeReport,
      dismissMergeReport: () => setMergeReport(null),
      mergeFailed,
      retryMerge: () => setMergeAttempt((n) => n + 1),
      add: async (product, quantity) => {
        // Never guess while the session is being restored: the item would land in the
        // wrong cart (see ProductDetailPage).
        if (mode === 'loading') throw new Error('Still checking your sign-in. Try again.')
        if (mode === 'account') {
          setAccountCart(await cartApi.add(product.id, quantity))
          return
        }
        guestUpdate((lines) =>
          addToGuestLines(lines, product.id, quantity, product.max_order_qty, product.price_cents),
        )
      },
      setQuantity: async (productId, quantity) => {
        if (mode === 'account') {
          setAccountCart(await cartApi.setQuantity(productId, quantity))
          return
        }
        guestUpdate((lines) =>
          lines.map((l) => (l.product_id === productId ? { ...l, quantity } : l)),
        )
      },
      remove: async (productId) => {
        if (mode === 'account') {
          setAccountCart(await cartApi.remove(productId))
          return
        }
        guestUpdate((lines) => lines.filter((l) => l.product_id !== productId))
      },
      clear: async () => {
        if (mode === 'account') {
          await cartApi.clear()
          setAccountCart(EMPTY_CART)
          return
        }
        writeGuestCart([])
      },
      acknowledgePrices: async () => {
        if (mode === 'account') {
          setAccountCart(await cartApi.acknowledgePrices())
          return
        }
        const current = new Map(cart?.items.map((i) => [i.product_id, i.unit_price_cents]))
        guestUpdate((lines) =>
          lines.map((l) => ({
            ...l,
            price_cents_seen: current.get(l.product_id) ?? l.price_cents_seen,
          })),
        )
      },
    }
  }, [
    mode,
    cart,
    account.isPending,
    guest.isPending,
    guestLines,
    itemCount,
    mergeReport,
    mergeFailed,
    setAccountCart,
  ])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartState {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
