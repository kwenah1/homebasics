import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  MAX_ADDRESSES,
  useAddresses,
  useCreateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
  useStates,
  useUpdateAddress,
} from '../../api/addresses'
import type { Address, UsState } from '../../api/addresses'
import { ApiError } from '../../api/client'
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form'
import { applyServerErrors } from '../../lib/formErrors'
import { addressSchema } from '../../lib/validation'
import type { AddressValues } from '../../lib/validation'

const FIELDS = ['label', 'recipient_name', 'line1', 'line2', 'city', 'state', 'postal_code'] as const

type FormProps = { initial?: Address; onDone: () => void; onCancel: () => void }

function AddressForm(props: FormProps) {
  const { data: states, isError } = useStates()
  // An uncontrolled <select> drops its value if the options aren't there yet, so wait.
  if (isError) return <FormAlert message="Could not load the list of states." />
  if (!states) return <p className="text-sm text-stone-500">Loading…</p>
  return <AddressFormFields {...props} states={states} />
}

function AddressFormFields({
  initial,
  onDone,
  onCancel,
  states,
}: FormProps & { states: UsState[] }) {
  const create = useCreateAddress()
  const update = useUpdateAddress()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: initial
      ? { ...initial, line2: initial.line2 ?? '' }
      : { label: 'Home', state: '', is_default: false },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      if (initial) {
        const { is_default: _, ...changes } = values
        await update.mutateAsync({ id: initial.id, ...changes })
      } else {
        await create.mutateAsync(values)
      }
      onDone()
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS) || null)
    }
  })

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-label={initial ? 'Edit address' : 'New address'}
      data-testid="address-form"
      className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2"
    >
      <FormAlert message={formError} testId="address-error" />
      <TextField label="Label" testId="address-label" error={errors.label?.message} {...register('label')} />
      <TextField
        label="Recipient name"
        autoComplete="name"
        testId="address-recipient"
        error={errors.recipient_name?.message}
        {...register('recipient_name')}
      />
      <TextField
        label="Street address"
        autoComplete="address-line1"
        testId="address-line1"
        className="sm:col-span-2"
        error={errors.line1?.message}
        {...register('line1')}
      />
      <TextField
        label="Apt, suite (optional)"
        autoComplete="address-line2"
        testId="address-line2"
        className="sm:col-span-2"
        error={errors.line2?.message}
        {...register('line2')}
      />
      <TextField
        label="City"
        autoComplete="address-level2"
        testId="address-city"
        error={errors.city?.message}
        {...register('city')}
      />
      <SelectField label="State" testId="address-state" error={errors.state?.message} {...register('state')}>
        <option value="">Choose…</option>
        {states.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <TextField
        label="ZIP code"
        autoComplete="postal-code"
        inputMode="numeric"
        testId="address-postal"
        error={errors.postal_code?.message}
        {...register('postal_code')}
      />
      {!initial && (
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" data-testid="address-default" {...register('is_default')} />
          Make this my default address
        </label>
      )}
      <div className="flex gap-3 sm:col-span-2">
        <div className="flex-1">
          <SubmitButton pending={isSubmitting} testId="address-submit">
            {initial ? 'Save address' : 'Add address'}
          </SubmitButton>
        </div>
        <button
          type="button"
          onClick={onCancel}
          data-testid="address-cancel"
          className="rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export function AddressBook() {
  const { data: addresses = [], isPending, isError } = useAddresses()
  const setDefault = useSetDefaultAddress()
  const remove = useDeleteAddress()
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const atLimit = addresses.length >= MAX_ADDRESSES

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await fn()
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Something went wrong.')
    }
  }

  if (isPending) return <p className="text-sm text-stone-500">Loading addresses…</p>
  if (isError) return <FormAlert message="Could not load your addresses." />

  return (
    <div className="space-y-4">
      <FormAlert message={actionError} testId="address-action-error" />
      {addresses.length === 0 && editing !== 'new' && (
        <p data-testid="address-empty" className="text-sm text-stone-600">
          You haven't saved any addresses yet.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="address-list">
        {addresses.map((a) =>
          editing !== 'new' && editing?.id === a.id ? (
            <li key={a.id} className="sm:col-span-2">
              <AddressForm initial={a} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li
              key={a.id}
              data-testid="address-card"
              data-default={a.is_default}
              className="rounded-xl border border-stone-200 p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{a.label}</p>
                {a.is_default && (
                  <span
                    data-testid="address-default-badge"
                    className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-900"
                  >
                    Default
                  </span>
                )}
              </div>
              <address className="mt-1 not-italic text-stone-700">
                {a.recipient_name}
                <br />
                {a.line1}
                {a.line2 && (
                  <>
                    <br />
                    {a.line2}
                  </>
                )}
                <br />
                {a.city}, {a.state} {a.postal_code}
              </address>
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
                <button type="button" className="text-brand-700 underline" data-testid="address-edit" onClick={() => setEditing(a)}>
                  Edit
                </button>
                {!a.is_default && (
                  <button
                    type="button"
                    className="text-brand-700 underline"
                    data-testid="address-make-default"
                    onClick={() => act(() => setDefault.mutateAsync(a.id))}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="text-red-700 underline"
                  data-testid="address-delete"
                  aria-label={`Delete ${a.label} address`}
                  onClick={() => act(() => remove.mutateAsync(a.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {editing === 'new' ? (
        <AddressForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={atLimit}
            onClick={() => setEditing('new')}
            data-testid="address-add"
            className="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add address
          </button>
          <span data-testid="address-count" className="text-sm text-stone-500">
            {addresses.length} of {MAX_ADDRESSES} saved
            {atLimit && ' - delete one to add another'}
          </span>
        </div>
      )}
    </div>
  )
}
