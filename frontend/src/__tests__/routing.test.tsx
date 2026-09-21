import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CATEGORIES } from '../data/categories'
import { renderApp } from '../test/render'

describe('routing and layout', () => {
  it('home page shows the hero and one tile per category', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/everyday essentials/i)
    const section = screen.getByRole('region', { name: /shop by category/i })
    expect(within(section).getAllByRole('link')).toHaveLength(CATEGORIES.length)
  })

  it('mentions the $50 free-shipping threshold (CHK-03)', () => {
    renderApp('/')
    expect(screen.getByText(/free standard shipping on orders of \$50 or more/i)).toBeVisible()
  })

  it('clicking a category tile navigates to the category page', async () => {
    renderApp('/')
    await userEvent.click(screen.getByTestId('category-tile-laundry'))
    expect(screen.getByTestId('placeholder-page')).toBeInTheDocument()
    expect(screen.getByTestId('nav-category-laundry')).toHaveClass('font-semibold')
  })

  it('unknown routes render the 404 page with a way home', async () => {
    renderApp('/no/such/page')
    expect(screen.getByTestId('not-found')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /back to the store/i }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/everyday essentials/i)
  })

  it('cart starts empty', () => {
    renderApp('/')
    expect(screen.getByTestId('cart-count')).toHaveTextContent('0')
  })

  it('has a skip link to main content (a11y)', () => {
    renderApp('/')
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute('href', '#main')
  })
})
