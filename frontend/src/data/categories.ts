// Presentation only (emoji + colours). Category names, slugs and counts come from the API.
export const CATEGORY_STYLE: Record<string, { emoji: string; bg: string; blurb: string }> = {
  kitchen: { emoji: '🍳', bg: 'bg-orange-50', blurb: 'Cookware, utensils & storage' },
  cleaning: { emoji: '🧽', bg: 'bg-sky-50', blurb: 'Sprays, mops & sponges' },
  bath: { emoji: '🛁', bg: 'bg-cyan-50', blurb: 'Towels, mats & toiletries' },
  laundry: { emoji: '🧺', bg: 'bg-violet-50', blurb: 'Detergent, hampers & racks' },
  storage: { emoji: '📦', bg: 'bg-amber-50', blurb: 'Bins, baskets & organizers' },
  'paper-goods': { emoji: '🧻', bg: 'bg-stone-100', blurb: 'Towels, tissue & wraps' },
  default: { emoji: '🏠', bg: 'bg-stone-100', blurb: 'Household essentials' },
}
