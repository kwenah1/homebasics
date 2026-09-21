import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { applyServerErrors } from '../../lib/formErrors'
import { registerSchema } from '../../lib/validation'
import type { RegisterValues } from '../../lib/validation'
import { AuthCard } from './AuthCard'

const FIELDS = ['first_name', 'last_name', 'email', 'password'] as const

export function RegisterPage() {
  const { status, register: signUp } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) })

  if (status === 'authenticated') return <Navigate to="/account" replace />

  const onSubmit = handleSubmit(async ({ first_name, last_name, email, password }) => {
    setFormError(null)
    try {
      await signUp({ first_name, last_name, email, password })
      navigate('/account', { replace: true })
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS) || null)
    }
  })

  return (
    <AuthCard
      title="Create your account"
      subtitle="Save addresses and check out faster."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" data-testid="link-login" className="font-medium text-brand-700 underline">
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Create account">
        <FormAlert message={formError} testId="register-error" />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="First name"
            autoComplete="given-name"
            testId="register-first-name"
            error={errors.first_name?.message}
            {...register('first_name')}
          />
          <TextField
            label="Last name"
            autoComplete="family-name"
            testId="register-last-name"
            error={errors.last_name?.message}
            {...register('last_name')}
          />
        </div>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          testId="register-email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          testId="register-password"
          hint="8-64 characters with at least one letter and one number."
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          testId="register-confirm-password"
          error={errors.confirm_password?.message}
          {...register('confirm_password')}
        />
        <SubmitButton pending={isSubmitting} testId="register-submit">
          Create account
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
