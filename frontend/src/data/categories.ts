// Mirrors backend seed categories. Replaced by GET /categories in Milestone 3.
export interface CategorySummary {
  slug: string
  name: string
  blurb: string
  emoji: string
}

export const CATEGORIES: CategorySummary[] = [
  { slug: 'kitchen', name: 'Kitchen', blurb: 'Cookware, utensils & storage', emoji: '🍳' },
  { slug: 'cleaning', name: 'Cleaning', blurb: 'Sprays, mops & sponges', emoji: '🧽' },
  { slug: 'bath', name: 'Bath', blurb: 'Towels, mats & toiletries', emoji: '🛁' },
  { slug: 'laundry', name: 'Laundry', blurb: 'Detergent, hampers & racks', emoji: '🧺' },
  { slug: 'storage', name: 'Storage', blurb: 'Bins, baskets & organizers', emoji: '📦' },
  { slug: 'paper-goods', name: 'Paper Goods', blurb: 'Towels, tissue & wraps', emoji: '🧻' },
]
