import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { ApiError } from '../api/client'

/**
 * Push server field errors (422 / 409 `fields`) onto the matching inputs.
 * Returns the message for a top-of-form alert, or '' if every error found a field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly Path<T>[],
): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'
  const unmatched = Object.entries(error.fields).filter(([field, message]) => {
    if ((knownFields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: 'server', message })
      return false
    }
    return true
  })
  if (Object.keys(error.fields).length && !unmatched.length) return ''
  return error.message
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_credentials') return 'Email or password is incorrect.'
    if (error.code === 'account_locked') {
      const minutes = Math.max(1, Math.ceil((error.error?.retry_after_seconds ?? 900) / 60))
      return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or reset your password.`
    }
    if (error.status === 422) return 'Check your email and password.'
  }
  return 'We could not sign you in. Please try again.'
}
