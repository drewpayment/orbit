'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signIn, authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// The session gate throws a FORBIDDEN whose message contains this phrase when an
// approved-but-unverified user tries to sign in. Match on the specific phrase so
// unrelated errors that merely mention "email" don't offer a resend action.
function isVerificationError(error: { message?: string } | null | undefined): boolean {
  return (error?.message || '').includes('verify your email')
}

function getErrorDisplay(error: any): { message: string; type: 'error' | 'info' | 'warning' } {
  const message = error?.message || ''

  if (message.includes('pending')) {
    return {
      message: 'Your registration is pending admin approval. You\'ll receive an email when your account is approved.',
      type: 'info',
    }
  }
  if (message.includes('not approved')) {
    return {
      message: 'Your registration was not approved. Contact an administrator for assistance.',
      type: 'error',
    }
  }
  if (message.includes('verify your email')) {
    return {
      message: 'Please verify your email before logging in. Check your inbox for a verification link.',
      type: 'warning',
    }
  }

  return {
    message: message || 'Invalid email or password.',
    type: 'error',
  }
}

const alertStyles = {
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetSuccess = searchParams.get('reset') === 'success'
  const inviteSuccess = searchParams.get('invite') === 'success'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorDisplay, setErrorDisplay] = useState<{ message: string; type: 'error' | 'info' | 'warning' } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showResend, setShowResend] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorDisplay(null)
    setShowResend(false)
    setResendStatus('idle')
    setLoading(true)

    try {
      const result = await signIn.email({
        email,
        password,
      })

      if (result.error) {
        setErrorDisplay(getErrorDisplay(result.error))
        setShowResend(isVerificationError(result.error))
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setErrorDisplay({ message: 'An unexpected error occurred', type: 'error' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendStatus('pending')
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: '/login',
      })
      setResendStatus(result?.error ? 'error' : 'sent')
    } catch (err) {
      console.error(err)
      setResendStatus('error')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Sign in to Orbit
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Or{' '}
          <Link
            href="/signup"
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            create a new account
          </Link>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {resetSuccess && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded">
            Password updated — sign in with your new password.
          </div>
        )}

        {inviteSuccess && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded">
            Your account is ready — sign in with the password you just set.
          </div>
        )}

        {errorDisplay && (
          <div className={`border px-4 py-3 rounded ${alertStyles[errorDisplay.type]}`}>
            {errorDisplay.message}
          </div>
        )}

        {showResend && (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleResend}
              disabled={resendStatus === 'pending'}
            >
              {resendStatus === 'pending' ? 'Sending...' : 'Resend verification email'}
            </Button>
            {resendStatus === 'sent' && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Verification email sent. Check your inbox for the link.
              </p>
            )}
            {resendStatus === 'error' && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Could not send the verification email. Please try again.
              </p>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
