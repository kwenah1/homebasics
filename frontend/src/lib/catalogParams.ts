import type { ProductQuery, ProductSort } from '../api/catalog'
import { centsToDollarInput, dollarsToCents } from './money'

/**
 * The product list's state lives in the URL (?q=&min=&max=&in_stock=1&sort=&page=), so every
 * view is shareable, survives reload and works with Back. Prices in the URL are dollars.
 * Anything malformed is quietly dropped rather than breaking the page.
 */
export interface ListState {
  q: string
  min?: number // cents
  max?: number // cents
  inStock: boolean
  sort: ProductSort
  page: number
}

export const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top rated' },
]

const SORTS = new Set(SORT_OPTIONS.map((o) => o.value))

export function parseListState(params: URLSearchParams): ListState {
  const sort = params.get('sort') as ProductSort
  const page = Number(params.get('page'))
  let min = dollarsToCents(params.get('min'))
  let max = dollarsToCents(params.get('max'))
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min]
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    min,
    max,
    inStock: params.get('in_stock') === '1',
    sort: SORTS.has(sort) ? sort : 'name',
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  }
}

export function toSearchParams(state: ListState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.min !== undefined) params.set('min', centsToDollarInput(state.min))
  if (state.max !== undefined) params.set('max', centsToDollarInput(state.max))
  if (state.inStock) params.set('in_stock', '1')
  if (state.sort !== 'name') params.set('sort', state.sort)
  if (state.page > 1) params.set('page', String(state.page))
  return params
}

export function toProductQuery(state: ListState, category?: string): ProductQuery {
  return {
    category,
    q: state.q || undefined,
    min_price_cents: state.min,
    max_price_cents: state.max,
    in_stock: state.inStock || undefined,
    sort: state.sort,
    page: state.page,
  }
}

export function hasFilters(state: ListState): boolean {
  return Boolean(state.q || state.min !== undefined || state.max !== undefined || state.inStock)
}
