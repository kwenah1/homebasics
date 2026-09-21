import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { ProductDetail } from '../api/catalog'
import { renderApp } from '../test/render'
import { detail } from '../test/catalogFixtures'
import { apiError, server } from '../test/server'

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

  it('in stock: Add is enabled (cart itself arrives in M4)', async () => {
    serve(detail())
    renderApp('/p/nonstick-frying-pan-10in')
    await userEvent.selectOptions(await screen.findByTestId('detail-qty'), '3')
    await userEvent.click(screen.getByTestId('add-to-cart'))
    expect(screen.getByTestId('add-to-cart-notice')).toHaveTextContent('you picked 3')
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
