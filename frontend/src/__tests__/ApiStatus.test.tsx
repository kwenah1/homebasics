import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { ApiStatus } from '../components/ApiStatus'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'

describe('ApiStatus', () => {
  it('shows checking while the request is in flight', () => {
    renderWithProviders(<ApiStatus />)
    expect(screen.getByTestId('api-status')).toHaveAttribute('data-state', 'checking')
  })

  it('shows online with the API version when healthy', async () => {
    renderWithProviders(<ApiStatus />)
    expect(await screen.findByText('Store online')).toBeInTheDocument()
    expect(screen.getByTestId('api-status')).toHaveAttribute('data-state', 'online')
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
  })

  it('shows degraded when the API returns 503 with a health body', async () => {
    server.use(
      http.get('/api/v1/health', () =>
        HttpResponse.json(
          { status: 'degraded', database: 'unavailable', version: '0.1.0', environment: 'test' },
          { status: 503 },
        ),
      ),
    )
    renderWithProviders(<ApiStatus />)
    expect(await screen.findByText(/database unavailable/i)).toBeInTheDocument()
    expect(screen.getByTestId('api-status')).toHaveAttribute('data-state', 'degraded')
  })

  it('shows offline when the API cannot be reached', async () => {
    server.use(http.get('/api/v1/health', () => HttpResponse.error()))
    renderWithProviders(<ApiStatus />)
    expect(await screen.findByText('Store offline')).toBeInTheDocument()
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument()
  })

  it('shows offline on an unexpected server error', async () => {
    server.use(http.get('/api/v1/health', () => new HttpResponse('boom', { status: 500 })))
    renderWithProviders(<ApiStatus />)
    expect(await screen.findByText('Store offline')).toBeInTheDocument()
  })
})
