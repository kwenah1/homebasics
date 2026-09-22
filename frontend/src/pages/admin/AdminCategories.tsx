import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { adminApi } from '../../api/admin'
import { ApiError } from '../../api/client'
import { FormAlert } from '../../components/form'

export function AdminCategories() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: ['admin', 'categories'], queryFn: adminApi.categories })
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<number | null>(null)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setNotice(null)
    try {
      await fn()
      await queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] })
      await queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNotice({ ok: true, text: ok })
      return true
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Failed.' })
      return false
    }
  }

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (await run(() => adminApi.createCategory(name), `Created “${name}”.`)) form.reset()
  }

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
      {notice && <FormAlert tone={notice.ok ? 'success' : 'error'} message={notice.text} testId="admin-notice" />}
      <form onSubmit={create} className="flex items-end gap-3" aria-label="New category">
        <label className="text-sm">
          New category
          <input name="name" required minLength={2} className="mt-1 block rounded-lg border border-stone-300 px-3 py-2" data-testid="admin-category-name" />
        </label>
        <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white" data-testid="admin-category-create">
          Add
        </button>
      </form>
      <table className="w-full rounded-xl bg-white text-sm" data-testid="admin-categories">
        <thead className="text-left text-stone-600">
          <tr>
            <th className="p-2">Name</th>
            <th>Slug</th>
            <th className="text-right">On sale</th>
            <th className="text-right">Archived</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {data?.map((c) => {
            const empty = c.active_products + c.archived_products === 0
            return (
              <tr key={c.id} className="border-t border-stone-100" data-testid="admin-category-row" data-slug={c.slug}>
                <td className="p-2">
                  {editing === c.id ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const name = String(new FormData(e.currentTarget).get('rename')).trim()
                        if (await run(() => adminApi.renameCategory(c.id, name), 'Renamed.')) setEditing(null)
                      }}
                      className="flex gap-2"
                    >
                      <input name="rename" defaultValue={c.name} aria-label={`New name for ${c.name}`} className="rounded border border-stone-300 px-2 py-1" data-testid="admin-category-rename" />
                      <button type="submit" className="underline">
                        Save
                      </button>
                    </form>
                  ) : (
                    c.name
                  )}
                </td>
                <td className="font-mono text-xs">{c.slug}</td>
                <td className="text-right">{c.active_products}</td>
                <td className="text-right">{c.archived_products}</td>
                <td className="space-x-3 p-2 text-right">
                  <button type="button" className="underline" onClick={() => setEditing(c.id)} data-testid="admin-category-edit">
                    Rename
                  </button>
                  <button
                    type="button"
                    className="text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!empty}
                    title={empty ? undefined : 'Move or archive its products first'}
                    onClick={() => run(() => adminApi.deleteCategory(c.id), `Deleted “${c.name}”.`)}
                    data-testid="admin-category-delete"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
