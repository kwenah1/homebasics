import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div data-testid="not-found" className="py-16 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-stone-500">We couldn't find what you were looking for.</p>
      <Link to="/" className="mt-6 inline-block font-medium text-brand-700 underline">
        Back to the store
      </Link>
    </div>
  )
}
