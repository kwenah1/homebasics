import { ApiError } from '../api/client'

/**
 * When may a retry reuse the same Idempotency-Key? (CHK-08)
 *
 * - No answer (network failure) or a 5xx: we don't know whether the server acted, so the
 *   retry MUST reuse the key - the server then returns the original result instead of
 *   acting twice.
 * - A definitive 4xx (declined, total changed, validation...): that attempt is finished.
 *   The next attempt is a *new* request and needs a new key; reusing it would be refused
 *   as "idempotency_key_reused" because the body differs.
 */
export function shouldKeepKey(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.status >= 500
}
