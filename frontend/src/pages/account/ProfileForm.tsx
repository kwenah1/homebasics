import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { updateProfile } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { applyServerErrors } from '../../lib/formErrors'
import { profileSchema } from '../../lib/validation'

type Values = z.infer<typeof profileSchema>

export function ProfileForm() {
  const { user, setUser } = useAuth()
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(profileSchema),
    values: { first_name: user?.first_name ?? '', last_name: user?.last_name ?? '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setMessage(null)
    try {
      setUser(await updateProfile(values))
      setMessage({ tone: 'success', text: 'Profile saved.' })
    } catch (error) {
      const text = applyServerErrors(error, setError, ['first_name', 'last_name'])
      if (text) setMessage({ tone: 'error', text })
    }
  })

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Profile">
      <FormAlert message={message?.text} tone={message?.tone} testId="profile-message" />
      <TextField
        label="First name"
        autoComplete="given-name"
        testId="profile-first-name"
        error={errors.first_name?.message}
        {...register('first_name')}
      />
      <TextField
        label="Last name"
        autoComplete="family-name"
        testId="profile-last-name"
        error={errors.last_name?.message}
        {...register('last_name')}
      />
      <SubmitButton pending={isSubmitting} testId="profile-submit">
        Save profile
      </SubmitButton>
    </form>
  )
}
