'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function InvalidTokenState() {
  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md text-center">
      <div className="mb-4">
        <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Reset link invalid or expired
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        This password reset link is invalid or expired. Reset links are valid for 1 hour.
      </p>
      <Link
        href="/forgot-password"
        className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
      >
        Request a new reset link
      </Link>
    </div>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const tokenError = searchParams.get('error') === 'INVALID_TOKEN'

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [serverError, setServerError] = useState(false)
  const [loading, setLoading] = useState(false)

  // Better-Auth redirects here with ?error=INVALID_TOKEN for a bad/expired link,
  // and a valid link arrives with ?token=... — both are handled up front.
  if (tokenError || !token) {
    return <InvalidTokenState />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })

      if (result?.error) {
        setServerError(true)
      } else {
        router.push('/login?reset=success')
      }
    } catch (err) {
      console.error(err)
      setServerError(true)
    } finally {
      setLoading(false)
    }
  }

  if (serverError) {
    return <InvalidTokenState />
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Set a new password
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Choose a new password for your Orbit account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-gray-500">
            Must be at least 8 characters
          </p>
        </div>

        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Resetting...' : 'Reset password'}
        </Button>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
