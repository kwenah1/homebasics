import { useHealth } from '../api/health'

type State = 'checking' | 'online' | 'degraded' | 'offline'

const LABELS: Record<State, string> = {
  checking: 'Checking store status…',
  online: 'Store online',
  degraded: 'Store degraded - database unavailable',
  offline: 'Store offline',
}

const DOT: Record<State, string> = {
  checking: 'bg-stone-400',
  online: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-red-500',
}

export function ApiStatus() {
  const { data, isPending, isError } = useHealth()
  const state: State = isPending
    ? 'checking'
    : isError
      ? 'offline'
      : data.status === 'ok'
        ? 'online'
        : 'degraded'

  return (
    <p
      data-testid="api-status"
      data-state={state}
      role="status"
      className="inline-flex items-center gap-2 text-xs text-stone-500"
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[state]}`} />
      {LABELS[state]}
      {data && state !== 'offline' && <span className="text-stone-500">v{data.version}</span>}
    </p>
  )
}
