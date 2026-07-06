'use client'

import { useState } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Better-Auth returns the same neutral response whether or not the account
      // exists, and only emits a reset email for real accounts. We ignore the
      // result entirely and always show the same state — no account enumeration.
      await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  if (submitted) {
    return (
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md text-center">
        <div className="mb-4">
          <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Check your email
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          If an account exists for that email, a password reset link is on its way. The link expires in 1 hour.
        </p>
        <Link
          href="/login"
          className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Reset your password
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Sending...' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        <Link
          href="/login"
          className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Back to login
        </Link>
      </p>
    </div>
  )
}
