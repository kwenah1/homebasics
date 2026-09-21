export function PlaceholderPage({ title, milestone }: { title: string; milestone: number }) {
  return (
    <div data-testid="placeholder-page">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-stone-500">Coming in Milestone {milestone}.</p>
    </div>
  )
}
