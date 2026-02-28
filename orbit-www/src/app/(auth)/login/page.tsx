'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  if (message.includes('verify your email') || message.includes('email')) {
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

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorDisplay, setErrorDisplay] = useState<{ message: string; type: 'error' | 'info' | 'warning' } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorDisplay(null)
    setLoading(true)

    try {
      const result = await signIn.email({
        email,
        password,
      })

      if (result.error) {
        setErrorDisplay(getErrorDisplay(result.error))
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
        {errorDisplay && (
          <div className={`border px-4 py-3 rounded ${alertStyles[errorDisplay.type]}`}>
            {errorDisplay.message}
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
          <Label htmlFor="password">Password</Label>
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
