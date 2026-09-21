import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../test/render'
import { page, product } from '../test/catalogFixtures'
import { apiError, server } from '../test/server'

/** Capture every /products request's query string. */
function recordProducts(respond = () => page([product()])) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/v1/products', ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json(respond())
    }),
  )
  return seen
}

describe('ProductListPage', () => {
  it('category page asks the API for that category and shows the count', async () => {
    const seen = recordProducts(() => page([product(), product({ id: 2, sku: 'KIT-002', name: 'Bowls' })]))
    renderApp('/c/kitchen')
    // The count element exists (empty) while loading, so wait for the text, not the element.
    expect(await screen.findByText('2 products')).toHaveAttribute('data-testid', 'result-count')
    expect(screen.getByTestId('list-heading')).toHaveTextContent('Kitchen')
    expect(seen.at(-1)?.get('category')).toBe('kitchen')
  })

  it('renders a card with price, stock badge and rating', async () => {
    recordProducts(() =>
      page([product({ price_cents: 399, stock_status: 'low_stock', stock_left: 1, rating_avg: null, rating_count: 0 })]),
    )
    renderApp('/products')
    const card = await screen.findByTestId('product-card')
    expect(within(card).getByTestId('product-price')).toHaveTextContent('$3.99')
    expect(within(card).getByTestId('stock-badge')).toHaveTextContent('Only 1 left')
    expect(within(card).getByTestId('rating')).toHaveTextContent('No reviews yet')
    expect(within(card).getByTestId('product-link')).toHaveAttribute('href', '/p/nonstick-frying-pan-10in')
  })

  it.each([
    ['out_of_stock', null, 'Out of stock'],
    ['low_stock', 5, 'Only 5 left'],
    ['in_stock', null, 'In stock'],
  ] as const)('stock badge for %s', async (status, left, text) => {
    recordProducts(() => page([product({ stock_status: status, stock_left: left })]))
    renderApp('/products')
    expect(await screen.findByTestId('stock-badge')).toHaveTextContent(text)
  })

  it('URL filters are sent to the API in cents', async () => {
    const seen = recordProducts()
    renderApp('/products?q=towel&min=10&max=49.99&in_stock=1&sort=price_asc&page=2')
    await screen.findByTestId('product-card')
    expect(Object.fromEntries(seen.at(-1)!)).toEqual({
      q: 'towel',
      min_price_cents: '1000',
      max_price_cents: '4999',
      in_stock: 'true',
      sort: 'price_asc',
      page: '2',
    })
    expect(screen.getByTestId('list-heading')).toHaveTextContent('Results for “towel”')
    expect(screen.getByTestId('filter-min')).toHaveValue('10')
  })

  it('changing sort resets to page 1', async () => {
    const seen = recordProducts(() => page([product()], { pages: 3, total: 50, page: 2 }))
    renderApp('/products?page=2')
    await screen.findByTestId('product-card')
    await userEvent.selectOptions(screen.getByTestId('sort'), 'rating')
    await screen.findByTestId('product-card')
    expect(seen.at(-1)?.get('sort')).toBe('rating')
    expect(seen.at(-1)?.get('page')).toBe('1')
  })

  it('pagination moves between pages and disables at the ends', async () => {
    const seen = recordProducts(() => page([product()], { pages: 2, total: 21 }))
    renderApp('/products')
    expect(await screen.findByTestId('page-indicator')).toHaveTextContent('Page 1 of 2')
    expect(screen.getByTestId('page-prev')).toBeDisabled()
    await userEvent.click(screen.getByTestId('page-next'))
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByTestId('page-next')).toBeDisabled()
    expect(seen.at(-1)?.get('page')).toBe('2')
  })

  it('price filter validates before calling the API', async () => {
    const seen = recordProducts()
    renderApp('/products')
    await screen.findByTestId('product-card')
    const before = seen.length
    await userEvent.type(screen.getByTestId('filter-min'), '50')
    await userEvent.type(screen.getByTestId('filter-max'), '10')
    await userEvent.click(screen.getByTestId('filter-apply'))
    expect(screen.getByTestId('filter-price-error')).toHaveTextContent('must not be more than')
    expect(seen.length).toBe(before)

    await userEvent.clear(screen.getByTestId('filter-max'))
    await userEvent.type(screen.getByTestId('filter-max'), 'ten')
    await userEvent.click(screen.getByTestId('filter-apply'))
    expect(screen.getByTestId('filter-price-error')).toHaveTextContent('Enter prices like')
  })

  it('shows chips and Clear all removes every filter', async () => {
    const seen = recordProducts()
    renderApp('/products?q=towel&max=20&in_stock=1')
    const chips = await screen.findByTestId('active-filters')
    expect(chips).toHaveTextContent('“towel”')
    expect(chips).toHaveTextContent('Up to $20.00')
    expect(chips).toHaveTextContent('In stock')
    await userEvent.click(screen.getByTestId('clear-filters'))
    await screen.findByTestId('product-card')
    expect([...seen.at(-1)!.keys()].sort()).toEqual(['page', 'sort'])
    expect(screen.queryByTestId('active-filters')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-q')).toHaveValue('')
  })

  it('empty results', async () => {
    recordProducts(() => page([]))
    renderApp('/products?q=lawnmower')
    expect(await screen.findByTestId('list-empty')).toHaveTextContent('No products match.')
    expect(screen.getByTestId('result-count')).toHaveTextContent('0 products')
  })

  it('unknown category shows the 404 page', async () => {
    server.use(http.get('/api/v1/products', () => apiError(404, 'category_not_found')))
    renderApp('/c/garden')
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })

  it('header search goes to results and keeps the term in the box', async () => {
    const seen = recordProducts()
    renderApp('/')
    const box = screen.getByTestId('header-search')
    await userEvent.type(box, '  bath towel {enter}')
    expect(await screen.findByTestId('list-heading')).toHaveTextContent('Results for “bath towel”')
    expect(seen.at(-1)?.get('q')).toBe('bath towel')
    expect(screen.getByTestId('header-search')).toHaveValue('bath towel')
  })
})
