import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import type { z } from 'zod'

import { forgotPassword } from '../../api/auth'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { forgotSchema } from '../../lib/validation'
import { AuthCard } from './AuthCard'

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null)
    try {
      await forgotPassword(email)
      setSent(true)
    } catch {
      setFormError('We could not send the email. Please try again.')
    }
  })

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link that works once and expires in 30 minutes."
      footer={
        <Link to="/login" className="font-medium text-brand-700 underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <FormAlert
          tone="success"
          testId="forgot-sent"
          message="If that email is registered, a reset link is on its way. Check your inbox."
        />
      ) : (
        <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Reset password">
          <FormAlert message={formError} testId="forgot-error" />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            testId="forgot-email"
            error={errors.email?.message}
            {...register('email')}
          />
          <SubmitButton pending={isSubmitting} testId="forgot-submit">
            Send reset link
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  )
}
