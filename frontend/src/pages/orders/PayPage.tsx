import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ApiError } from '../../api/client'
import { orderApi, useOrder } from '../../api/orders'
import { FormAlert, SubmitButton, TextField } from '../../components/form'
import { expiryInPast, formatCardNumber, luhnValid, newIdempotencyKey, parseExpiry, TEST_CARDS } from '../../lib/card'
import { shouldKeepKey } from '../../lib/idempotency'
import { formatCents } from '../../lib/money'

const cardSchema = z
  .object({
    card_number: z.string().refine(luhnValid, 'Check the card number.'),
    expiry: z.string().refine((v) => parseExpiry(v) !== null, 'Use MM/YY.'),
    cvc: z.string().regex(/^\d{3,4}$/, 'Enter the 3 or 4 digit code.'),
    name_on_card: z.string().trim().min(1, 'Enter the name on the card.'),
  })
  .superRefine((v, ctx) => {
    const exp = parseExpiry(v.expiry)
    if (exp && expiryInPast(exp.month, exp.year)) {
      ctx.addIssue({ code: 'custom', path: ['expiry'], message: 'This card has expired.' })
    }
  })

type CardForm = z.infer<typeof cardSchema>

function useSecondsLeft(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  if (!deadline) return null
  return Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000))
}

export function PayPage() {
  const { orderNumber = '' } = useParams()
  const queryClient = useQueryClient()
  const { data: order, isPending, isError } = useOrder(orderNumber)
  const secondsLeft = useSecondsLeft(order?.payment_expires_at ?? null)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  // Regression (found by a unit test): after paying, the refetched order has can_pay=false,
  // so the 'already paid' redirect below fired first and dropped the confirmation message.
  const [justPaid, setJustPaid] = useState(false)
  const idempotencyKey = useRef(newIdempotencyKey())

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CardForm>({ resolver: zodResolver(cardSchema) })

  if (isPending) return <p className="text-sm text-stone-500">Loading…</p>
  if (isError || !order) return <FormAlert message="We couldn't load this order." />
  if (justPaid) return <Navigate to={`/orders/${orderNumber}?paid=1`} replace />
  if (!order.can_pay && !expired) return <Navigate to={`/orders/${orderNumber}`} replace />

  const windowClosed = expired || secondsLeft === 0

  // The key is read when the form is submitted, never during render.
  const submitCard = async (values: CardForm) => {
    setError(null)
    const exp = parseExpiry(values.expiry)!
    try {
      await orderApi.pay(
        orderNumber,
        {
          card_number: values.card_number,
          exp_month: exp.month,
          exp_year: exp.year,
          cvc: values.cvc,
          name_on_card: values.name_on_card,
        },
        idempotencyKey.current,
      )
      setJustPaid(true)
      await queryClient.invalidateQueries({ queryKey: ['order', orderNumber] })
    } catch (e) {
      if (!shouldKeepKey(e)) idempotencyKey.current = newIdempotencyKey()
      if (e instanceof ApiError && e.code === 'order_expired') {
        setExpired(true)
      } else {
        setError(e instanceof ApiError ? e.message : 'We could not reach the payment service. Please try again.')
      }
    }
  }

  const minutes = Math.floor((secondsLeft ?? 0) / 60)
  const seconds = String((secondsLeft ?? 0) % 60).padStart(2, '0')

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Pay for order {order.order_number}</h1>
      <p className="text-lg" data-testid="pay-total">
        Total: <strong>{formatCents(order.total_cents)}</strong>
      </p>

      {windowClosed ? (
        <div role="alert" data-testid="pay-expired" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          The 30-minute payment window has closed and the items went back on sale.{' '}
          <Link to="/cart" className="font-medium underline">
            Back to your cart
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-stone-600" data-testid="pay-countdown" aria-live="off">
            Time left to pay: {minutes}:{seconds}
          </p>

          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" data-testid="test-cards">
            <p className="font-medium">Practice store: use a test card</p>
            <ul className="mt-2 space-y-1">
              {TEST_CARDS.map((c) => (
                <li key={c.number} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{c.number}</span>
                  <span className="text-xs">{c.outcome}</span>
                  <button
                    type="button"
                    className="text-xs font-medium underline"
                    data-testid={`use-card-${c.number.slice(-4)}`}
                    onClick={() => {
                      setValue('card_number', c.number, { shouldValidate: true })
                      setValue('expiry', '12/35')
                      setValue('cvc', '123')
                      setValue('name_on_card', 'Test Shopper')
                    }}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <form noValidate onSubmit={(e) => handleSubmit(submitCard)(e)} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6" aria-label="Card details">
            <FormAlert message={error} testId="pay-error" />
            <TextField
              label="Card number"
              inputMode="numeric"
              autoComplete="cc-number"
              testId="card-number"
              error={errors.card_number?.message}
              {...register('card_number', {
                onChange: (e) => setValue('card_number', formatCardNumber(e.target.value)),
              })}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Expiry (MM/YY)"
                autoComplete="cc-exp"
                placeholder="MM/YY"
                testId="card-expiry"
                error={errors.expiry?.message}
                {...register('expiry')}
              />
              <TextField
                label="CVC"
                inputMode="numeric"
                autoComplete="cc-csc"
                testId="card-cvc"
                error={errors.cvc?.message}
                {...register('cvc')}
              />
            </div>
            <TextField
              label="Name on card"
              autoComplete="cc-name"
              testId="card-name"
              error={errors.name_on_card?.message}
              {...register('name_on_card')}
            />
            <SubmitButton pending={isSubmitting} testId="pay-submit">
              Pay {formatCents(order.total_cents)}
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  )
}
