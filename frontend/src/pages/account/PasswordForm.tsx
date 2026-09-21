import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { changePassword } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { applyServerErrors } from '../../lib/formErrors'
import { passwordChangeSchema } from '../../lib/validation'

type Values = z.infer<typeof passwordChangeSchema>

export function PasswordForm() {
  const { setUser } = useAuth()
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(passwordChangeSchema) })

  const onSubmit = handleSubmit(async ({ current_password, new_password }) => {
    setMessage(null)
    try {
      setUser(await changePassword(current_password, new_password))
      reset()
      setMessage({
        tone: 'success',
        text: 'Password changed. Other devices have been signed out.',
      })
    } catch (error) {
      const text = applyServerErrors(error, setError, ['current_password', 'new_password'])
      if (text) setMessage({ tone: 'error', text })
    }
  })

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Change password">
      <FormAlert message={message?.text} tone={message?.tone} testId="password-message" />
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        testId="password-current"
        error={errors.current_password?.message}
        {...register('current_password')}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        testId="password-new"
        error={errors.new_password?.message}
        {...register('new_password')}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        testId="password-confirm"
        error={errors.confirm_password?.message}
        {...register('confirm_password')}
      />
      <SubmitButton pending={isSubmitting} testId="password-submit">
        Change password
      </SubmitButton>
    </form>
  )
}
