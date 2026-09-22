import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { ProductDetail } from '../api/catalog'
import { renderApp } from '../test/render'
import { detail } from '../test/catalogFixtures'
import { cartOf, line, previewHandler, seedGuestCart, storedGuestCart } from '../test/cartFixtures'
import { apiError, casey, server, signedIn, tokenFor } from '../test/server'

function serve(product: ProductDetail) {
  server.use(http.get(`/api/v1/products/${product.slug}`, () => HttpResponse.json(product)))
}

describe('ProductDetailPage', () => {
  it('shows name, price, description, breadcrumb and SKU', async () => {
    serve(detail())
    renderApp('/p/nonstick-frying-pan-10in')
    expect(await screen.findByTestId('detail-name')).toHaveTextContent('Nonstick Frying Pan 10in')
    expect(screen.getByTestId('detail-price')).toHaveTextContent('$24.99')
    expect(screen.getByTestId('detail-description')).toHaveTextContent('PFOA-free')
    expect(screen.getByTestId('breadcrumb-category')).toHaveAttribute('href', '/c/kitchen')
    expect(screen.getByText('SKU KIT-001')).toBeInTheDocument()
  })

  it.each([
    [10, 10],
    [3, 3],
    [1, 1],
  ])('quantity options go up to max_order_qty=%i', async (max, options) => {
    serve(detail({ max_order_qty: max }))
    renderApp('/p/nonstick-frying-pan-10in')
    const select = await screen.findByTestId('detail-qty')
    expect(within(select).getAllByRole('option')).toHaveLength(options)
  })

  it('out of stock: Add is disabled and says so (CAT-05)', async () => {
    serve(detail({ stock_status: 'out_of_stock', stock_left: null, max_order_qty: 0 }))
    renderApp('/p/nonstick-frying-pan-10in')
    const add = await screen.findByTestId('add-to-cart')
    expect(add).toBeDisabled()
    expect(add).toHaveTextContent('Out of stock')
    expect(screen.getByTestId('detail-qty')).toBeDisabled()
    expect(screen.getByTestId('stock-badge')).toHaveTextContent('Out of stock')
  })

  it('Add waits until the session is known (regression: it went into the guest cart)', async () => {
    let finishRefresh!: () => void
    serve(detail())
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await new Promise<void>((resolve) => (finishRefresh = resolve))
        return HttpResponse.json(tokenFor())
      }),
      http.get('/api/v1/me', () => HttpResponse.json(casey)),
      http.post('/api/v1/cart/items', () => HttpResponse.json(cartOf([line(1, 1)]))),
    )
    renderApp('/p/nonstick-frying-pan-10in')
    const add = await screen.findByTestId('add-to-cart')
    expect(add).toBeDisabled()

    finishRefresh()
    await waitFor(() => expect(add).toBeEnabled())
    await userEvent.click(add)
    expect(await screen.findByTestId('add-to-cart-success')).toBeInTheDocument()
    expect(storedGuestCart()).toEqual([]) // went to the account, not the browser
  })

  describe('Add to cart as a guest', () => {
    it('stores the line with the price seen and updates the header count', async () => {
      serve(detail())
      server.use(previewHandler())
      renderApp('/p/nonstick-frying-pan-10in')
      await userEvent.selectOptions(await screen.findByTestId('detail-qty'), '3')
      await waitFor(() => expect(screen.getByTestId('add-to-cart')).toBeEnabled())
      await userEvent.click(screen.getByTestId('add-to-cart'))

      expect(await screen.findByTestId('add-to-cart-success')).toHaveTextContent('Added 3 to your cart.')
      expect(storedGuestCart()).toEqual([{ product_id: 1, quantity: 3, price_cents_seen: 2499 }])
      expect(screen.getByTestId('cart-count')).toHaveTextContent('3')
      expect(screen.getByTestId('view-cart')).toHaveAttribute('href', '/cart')
    })

    it('refuses to go past the limit, before any request (CRT-01)', async () => {
      serve(detail({ max_order_qty: 5, stock_status: 'low_stock', stock_left: 5 }))
      server.use(previewHandler())
      seedGuestCart([{ product_id: 1, quantity: 4 }])
      renderApp('/p/nonstick-frying-pan-10in')
      await userEvent.selectOptions(await screen.findByTestId('detail-qty'), '2')
      await waitFor(() => expect(screen.getByTestId('add-to-cart')).toBeEnabled())
      await userEvent.click(screen.getByTestId('add-to-cart'))

      expect(await screen.findByTestId('add-to-cart-error')).toHaveTextContent('at most 5')
      expect(storedGuestCart()).toEqual([{ product_id: 1, quantity: 4 }])
    })
  })

  describe('Add to cart when signed in', () => {
    it('calls the API and shows the new count', async () => {
      let body: unknown
      serve(detail())
      server.use(
        ...signedIn(),
        http.post('/api/v1/cart/items', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json(cartOf([line(1, 2)]))
        }),
      )
      renderApp('/p/nonstick-frying-pan-10in')
      await userEvent.selectOptions(await screen.findByTestId('detail-qty'), '2')
      await waitFor(() => expect(screen.getByTestId('add-to-cart')).toBeEnabled())
      await userEvent.click(screen.getByTestId('add-to-cart'))

      expect(await screen.findByTestId('add-to-cart-success')).toBeInTheDocument()
      expect(body).toEqual({ product_id: 1, quantity: 2 })
      expect(screen.getByTestId('cart-count')).toHaveTextContent('2')
      expect(screen.getByTestId('in-cart')).toHaveTextContent('2 already in your cart.')
    })

    it("shows the server's refusal", async () => {
      serve(detail())
      server.use(
        ...signedIn(),
        http.post('/api/v1/cart/items', () =>
          apiError(409, 'quantity_limit', 'You can have at most 10 of this item in your cart.', {
            max_quantity: 10,
            in_cart: 10,
          }),
        ),
      )
      renderApp('/p/nonstick-frying-pan-10in')
      await waitFor(() => expect(screen.getByTestId('add-to-cart')).toBeEnabled())
      await userEvent.click(screen.getByTestId('add-to-cart'))
      expect(await screen.findByTestId('add-to-cart-error')).toHaveTextContent('at most 10')
    })
  })

  it('unknown or archived product shows the 404 page', async () => {
    server.use(http.get('/api/v1/products/discontinued-toaster', () => apiError(404, 'product_not_found')))
    renderApp('/p/discontinued-toaster')
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })

  it('server error shows a message, not a blank page', async () => {
    server.use(http.get('/api/v1/products/broken', () => apiError(500, 'http_error')))
    renderApp('/p/broken')
    expect(await screen.findByTestId('detail-error')).toBeInTheDocument()
  })
})
