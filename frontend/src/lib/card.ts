/** Client-side card checks mirror the server's (CHK-07); the server remains the authority. */

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', outcome: 'Payment succeeds' },
  { number: '4000 0000 0000 0002', outcome: 'Card declined' },
  { number: '4000 0000 0000 9995', outcome: 'Insufficient funds' },
] as const

export function digitsOnly(value: string): string {
  return value.replace(/[\s-]/g, '')
}

export function luhnValid(raw: string): boolean {
  const number = digitsOnly(raw)
  if (!/^\d{12,19}$/.test(number)) return false
  let sum = 0
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/** "4242424242424242" -> "4242 4242 4242 4242" (max 19 digits). */
export function formatCardNumber(value: string): string {
  return digitsOnly(value)
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** Parse "MM/YY" or "MM/YYYY". Returns null when malformed. */
export function parseExpiry(value: string): { month: number; year: number } | null {
  const match = value.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!match) return null
  const month = Number(match[1])
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2])
  if (month < 1 || month > 12) return null
  return { month, year }
}

/** Valid through the end of the expiry month (same rule as the server). */
export function expiryInPast(month: number, year: number, now = new Date()): boolean {
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
}

/** A fresh Idempotency-Key (32 hex chars, within the server's 8-48 limit). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
