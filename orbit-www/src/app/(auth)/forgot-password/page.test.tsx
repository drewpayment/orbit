import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const mockRequestPasswordReset = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
  },
}))

import ForgotPasswordPage from './page'

async function fillAndSubmit(email = 'u@test.com') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email address'), email)
  await user.click(screen.getByRole('button', { name: /send reset link/i }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('ForgotPasswordPage', () => {
  it('renders the email form and a back-to-login link', () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to login/i })).toHaveAttribute('href', '/login')
  })

  it('calls requestPasswordReset with the entered email and redirectTo, then shows the neutral success state', async () => {
    mockRequestPasswordReset.mockResolvedValue({ data: { status: true }, error: null })

    render(<ForgotPasswordPage />)
    await fillAndSubmit('known@test.com')

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'known@test.com',
        redirectTo: '/reset-password',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/if an account exists/i)).toBeInTheDocument()
    })
  })

  it('shows the identical neutral success state even when the API returns an error (no account enumeration)', async () => {
    mockRequestPasswordReset.mockResolvedValue({ data: null, error: { message: 'boom' } })

    render(<ForgotPasswordPage />)
    await fillAndSubmit('unknown@test.com')

    await waitFor(() => {
      expect(screen.getByText(/if an account exists/i)).toBeInTheDocument()
    })
    // The email form is gone; the success state does not reveal whether the account exists.
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
  })
})
