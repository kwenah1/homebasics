import { z } from 'zod'

/** ACC-02 - mirrors backend app/core/security.py password_problems(). */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

export function passwordProblems(password: string): string[] {
  const problems: string[] = []
  if (password.length < PASSWORD_MIN) problems.push(`at least ${PASSWORD_MIN} characters`)
  if (password.length > PASSWORD_MAX || new TextEncoder().encode(password).length > 72)
    problems.push(`at most ${PASSWORD_MAX} characters`)
  if (!/[A-Za-z]/.test(password)) problems.push('at least one letter')
  if (!/\d/.test(password)) problems.push('at least one number')
  return problems
}

export const newPassword = z.string().superRefine((value, ctx) => {
  const problems = passwordProblems(value)
  if (problems.length) ctx.addIssue({ code: 'custom', message: `Password needs ${problems.join(', ')}.` })
})

const email = z.string().trim().min(1, 'Enter your email.').pipe(z.email('Enter a valid email address.'))
const name = (label: string) => z.string().trim().min(1, `Enter your ${label}.`).max(80)

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z
  .object({
    first_name: name('first name'),
    last_name: name('last name'),
    email,
    password: newPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match.',
  })

export const forgotSchema = z.object({ email })

export const resetSchema = z
  .object({ new_password: newPassword, confirm_password: z.string() })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match.',
  })

export const profileSchema = z.object({ first_name: name('first name'), last_name: name('last name') })

export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: newPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match.',
  })

export const addressSchema = z.object({
  label: z.string().trim().min(1, 'Enter a label.').max(40),
  recipient_name: z.string().trim().min(1, 'Enter the recipient name.').max(160),
  line1: z.string().trim().min(1, 'Enter a street address.').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'Enter a city.').max(100),
  state: z.string().length(2, 'Choose a state.'),
  postal_code: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP (or ZIP+4).'),
  is_default: z.boolean().optional(),
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type AddressValues = z.infer<typeof addressSchema>

/**
 * Only allow same-site relative redirects after login. Blocks open-redirect tricks like
 * ?next=https://evil.com, ?next=//evil.com and ?next=/\evil.com.
 */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback
  }
  return next
}
