import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockPush = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

const mockResetPassword = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  },
}))

import ResetPasswordPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mockSearchParams = new URLSearchParams('token=valid-token')
})

afterEach(() => {
  cleanup()
})

describe('ResetPasswordPage', () => {
  it('renders the new-password form when a token is present', () => {
    render(<ResetPasswordPage />)
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument()
  })

  it('shows an error state with a link to /forgot-password when the token is missing', () => {
    mockSearchParams = new URLSearchParams()
    render(<ResetPasswordPage />)

    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request a new/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('shows the error state when the query carries error=INVALID_TOKEN', () => {
    mockSearchParams = new URLSearchParams('error=INVALID_TOKEN')
    render(<ResetPasswordPage />)

    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /invalid or expired/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request a new/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('rejects a password shorter than 8 characters without calling the API', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords without calling the API', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New password'), 'Password1234')
    await user.type(screen.getByLabelText('Confirm password'), 'Password9999')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('submits the new password with the token and redirects to login on success', async () => {
    mockResetPassword.mockResolvedValue({ data: { status: true }, error: null })
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New password'), 'Password1234')
    await user.type(screen.getByLabelText('Confirm password'), 'Password1234')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: 'Password1234',
        token: 'valid-token',
      })
    })
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login?reset=success')
    })
  })

  it('surfaces a server error inline and offers the forgot-password path', async () => {
    mockResetPassword.mockResolvedValue({
      data: null,
      error: { message: 'invalid token' },
    })
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    await user.type(screen.getByLabelText('New password'), 'Password1234')
    await user.type(screen.getByLabelText('Confirm password'), 'Password1234')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /request a new/i })).toHaveAttribute(
        'href',
        '/forgot-password',
      )
    })
    expect(mockPush).not.toHaveBeenCalled()
  })
})
