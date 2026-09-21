import AxeBuilder from '@axe-core/playwright'

import { expect, test } from '../fixtures'

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'category', path: '/c/kitchen' },
  { name: '404', path: '/missing' },
]

test.describe('accessibility (WCAG 2.1 AA) @a11y', () => {
  for (const { name, path } of PAGES) {
    test(`${name} page has no axe violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByTestId('api-status')).not.toHaveAttribute('data-state', 'checking')

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
    })
  }
})
