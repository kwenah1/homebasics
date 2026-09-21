import type { Category, ProductDetail, ProductPage, ProductSummary } from '../api/catalog'

const NAMES: Record<string, string> = {
  kitchen: 'Kitchen',
  cleaning: 'Cleaning',
  bath: 'Bath',
  laundry: 'Laundry',
  storage: 'Storage',
  'paper-goods': 'Paper Goods',
}

export const categories: Category[] = Object.entries(NAMES).map(([slug, name], i) => ({
  id: i + 1,
  slug,
  name,
  description: null,
  product_count: 10,
}))

export function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 1,
    sku: 'KIT-001',
    slug: 'nonstick-frying-pan-10in',
    name: 'Nonstick Frying Pan 10in',
    price_cents: 2499,
    category: { slug: 'kitchen', name: 'Kitchen' },
    stock_status: 'in_stock',
    stock_left: null,
    rating_avg: 4.2,
    rating_count: 37,
    ...overrides,
  }
}

export function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...product(),
    description: 'PFOA-free nonstick pan with a stay-cool handle.',
    images: [],
    max_order_qty: 10,
    ...overrides,
  }
}

export function page(items: ProductSummary[], extra: Partial<ProductPage> = {}): ProductPage {
  return { items, total: items.length, page: 1, page_size: 20, pages: items.length ? 1 : 0, ...extra }
}
