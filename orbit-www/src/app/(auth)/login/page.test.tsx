import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockPush = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

const mockSignInEmail = vi.fn()
const mockSendVerificationEmail = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  signIn: { email: (...args: unknown[]) => mockSignInEmail(...args) },
  authClient: {
    sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
  },
}))

import LoginPage from './page'

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email address'), 'u@test.com')
  await user.type(screen.getByLabelText('Password'), 'Password1234')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSearchParams = new URLSearchParams()
})

afterEach(() => {
  cleanup()
})

describe('LoginPage — verification error resend', () => {
  it('shows a Resend verification email button when sign-in fails with the verify-email error', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: 'Please verify your email before logging in. Check your inbox.' },
    })

    render(<LoginPage />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i }),
      ).toBeInTheDocument()
    })
  })

  it('does NOT show the resend button for an invalid-credentials error', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: 'Invalid email or password' },
    })

    render(<LoginPage />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: /resend verification email/i }),
    ).not.toBeInTheDocument()
  })

  it('resends via the Better Auth client with the entered email and shows sent feedback', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: 'Please verify your email before logging in. Check your inbox.' },
    })
    mockSendVerificationEmail.mockResolvedValue({ data: {}, error: null })

    render(<LoginPage />)
    const user = await fillAndSubmit()

    const resendBtn = await screen.findByRole('button', {
      name: /resend verification email/i,
    })
    await user.click(resendBtn)

    await waitFor(() => {
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        email: 'u@test.com',
        callbackURL: '/login',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/verification email sent/i)).toBeInTheDocument()
    })
  })

  it('shows a Forgot password link pointing at /forgot-password', () => {
    render(<LoginPage />)
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('shows the password-updated notice when ?reset=success is present', () => {
    mockSearchParams = new URLSearchParams('reset=success')
    render(<LoginPage />)
    expect(screen.getByText(/password updated/i)).toBeInTheDocument()
  })

  it('does not show the password-updated notice by default', () => {
    render(<LoginPage />)
    expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument()
  })

  it('shows failure feedback when the resend call errors', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: 'Please verify your email before logging in. Check your inbox.' },
    })
    mockSendVerificationEmail.mockResolvedValue({ data: null, error: { message: 'boom' } })

    render(<LoginPage />)
    const user = await fillAndSubmit()

    const resendBtn = await screen.findByRole('button', {
      name: /resend verification email/i,
    })
    await user.click(resendBtn)

    await waitFor(() => {
      expect(screen.getByText(/could not send/i)).toBeInTheDocument()
    })
  })
})
