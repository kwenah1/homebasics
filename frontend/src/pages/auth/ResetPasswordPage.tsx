import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { z } from 'zod'

import { resetPassword } from '../../api/auth'
import { ApiError } from '../../api/client'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { applyServerErrors } from '../../lib/formErrors'
import { resetSchema } from '../../lib/validation'
import { AuthCard } from './AuthCard'

type Values = z.infer<typeof resetSchema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const [linkDead, setLinkDead] = useState(!token)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(resetSchema) })

  const onSubmit = handleSubmit(async ({ new_password }) => {
    setFormError(null)
    try {
      await resetPassword(token!, new_password)
      navigate('/login?reset=1', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_reset_token') {
        setLinkDead(true)
        return
      }
      setFormError(applyServerErrors(error, setError, ['new_password']) || null)
    }
  })

  return (
    <AuthCard title="Choose a new password">
      {linkDead ? (
        <div className="space-y-4">
          <FormAlert
            testId="reset-invalid"
            message="This reset link is invalid or has expired. Links work once and last 30 minutes."
          />
          <Link
            to="/forgot-password"
            data-testid="link-request-new"
            className="block text-center font-medium text-brand-700 underline"
          >
            Request a new link
          </Link>
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Choose a new password">
          <FormAlert message={formError} testId="reset-error" />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            testId="reset-password"
            hint="8-64 characters with at least one letter and one number."
            error={errors.new_password?.message}
            {...register('new_password')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            testId="reset-confirm-password"
            error={errors.confirm_password?.message}
            {...register('confirm_password')}
          />
          <SubmitButton pending={isSubmitting} testId="reset-submit">
            Update password
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  )
}
