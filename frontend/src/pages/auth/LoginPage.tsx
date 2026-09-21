import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { loginErrorMessage } from '../../lib/formErrors'
import { loginSchema, safeNext } from '../../lib/validation'
import type { LoginValues } from '../../lib/validation'
import { AuthCard } from './AuthCard'

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  if (status === 'authenticated') return <Navigate to={next} replace />

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null)
    try {
      await login(email, password)
      navigate(next, { replace: true })
    } catch (error) {
      setFormError(loginErrorMessage(error))
    }
  })

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to HomeBasics."
      footer={
        <>
          New here?{' '}
          <Link to="/register" data-testid="link-register" className="font-medium text-brand-700 underline">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4" aria-label="Sign in">
        {params.get('reset') === '1' && (
          <FormAlert
            tone="success"
            testId="reset-success"
            message="Password updated. Sign in with your new password."
          />
        )}
        <FormAlert message={formError} testId="login-error" />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          testId="login-email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          testId="login-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="text-right text-sm">
          <Link to="/forgot-password" data-testid="link-forgot" className="text-brand-700 underline">
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={isSubmitting} testId="login-submit">
          Sign in
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
