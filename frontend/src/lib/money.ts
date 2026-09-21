const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** CHK-05: all money is integer cents; format only at the edge. */
export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}

/**
 * Parse a dollar amount typed by a shopper ("12", "12.5", "$12.50") into cents.
 * Returns undefined for blank or invalid input, so it can go straight into an optional filter.
 */
export function dollarsToCents(input: string | null | undefined): number | undefined {
  const cleaned = (input ?? '').trim().replace(/^\$/, '')
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(cleaned)) return undefined
  const [whole, fraction = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export function centsToDollarInput(cents: number | undefined): string {
  if (cents === undefined) return ''
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}
