// src/app/(setup)/setup/setup-flow.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import SetupPage from './page'

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // explicit cleanup — auto-cleanup via globals is not enabled in vitest.config.mts
    cleanup()
  })

  it('renders the setup form with all fields', () => {
    render(<SetupPage />)
    expect(screen.getByText('Welcome to Orbit')).toBeInTheDocument()
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeInTheDocument()
  })

  it('shows error when passwords do not match', async () => {
    const { container } = render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'different')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('form', { name: 'Setup form' })!)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match')
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows error when password is too short', async () => {
    const { container } = render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm Password'), 'short')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('form', { name: 'Setup form' })!)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters')
    })
  })

  it('submits form and redirects on success', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })

    const { container } = render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin User')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('form', { name: 'Setup form' })!)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Admin User',
          email: 'admin@test.com',
          password: 'password123',
          workspaceName: 'My Team',
        }),
      })
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows API error message on failure', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Setup has already been completed' }),
    })

    const { container } = render(<SetupPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Full Name'), 'Admin')
    await user.type(screen.getByLabelText('Email address'), 'admin@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.type(screen.getByLabelText('Workspace Name'), 'My Team')

    fireEvent.submit(screen.getByRole('form', { name: 'Setup form' })!)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Setup has already been completed')
    })
  })
})
