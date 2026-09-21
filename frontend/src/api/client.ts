export const API_BASE = '/api/v1'

/** Backend error shape: {"error": {"code", "message", "fields"?, ...}} */
export interface ApiErrorBody {
  code: string
  message: string
  fields?: Record<string, string>
  retry_after_seconds?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(ApiError.extract(body)?.message ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  private static extract(body: unknown): ApiErrorBody | undefined {
    if (body && typeof body === 'object' && 'error' in body) {
      return (body as { error: ApiErrorBody }).error
    }
    return undefined
  }

  get error(): ApiErrorBody | undefined {
    return ApiError.extract(this.body)
  }

  get code(): string | undefined {
    return this.error?.code
  }

  get fields(): Record<string, string> {
    return this.error?.fields ?? {}
  }
}

// --- Access token (memory only - never localStorage, so XSS can't lift it) -------------

let accessToken: string | null = null
let refreshInFlight: Promise<string | null> | null = null
const sessionListeners = new Set<(token: string | null) => void>()

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

/** Notified when a background refresh fails (session over) or succeeds. */
export function onSessionChange(listener: (token: string | null) => void) {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : response.text()
}

/**
 * Exchange the httpOnly refresh cookie for a new access token. Concurrent callers share
 * one request - rotation means a second parallel refresh would look like token reuse.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const token = response.ok
        ? ((await response.json()) as { access_token: string }).access_token
        : null
      setAccessToken(token)
      sessionListeners.forEach((listener) => listener(token))
      return token
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  /** Attach the access token and transparently refresh it once on expiry. */
  auth?: boolean
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, auth = false, headers, ...init } = options

  const send = () =>
    fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })

  let response = await send()
  if (auth && response.status === 401) {
    const body = (await parse(response.clone())) as { error?: ApiErrorBody } | undefined
    if (body?.error?.code === 'token_expired' && (await refreshAccessToken())) {
      response = await send()
    }
  }

  const body = await parse(response)
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}
