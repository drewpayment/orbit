'use client'

import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'

interface PostHogIdentifyProps {
  userId: string
  email?: string
  name?: string
}

/**
 * Identifies the authenticated user in PostHog.
 *
 * Drop this inside any client component that has access to the user's
 * session data. It calls posthog.identify() once per mount so session
 * recordings and events are tied to the real user.
 */
export function PostHogIdentify({ userId, email, name }: PostHogIdentifyProps) {
  const posthog = usePostHog()

  useEffect(() => {
    if (!posthog || !userId) return

    posthog.identify(userId, {
      ...(email && { email }),
      ...(name && { name }),
    })
  }, [posthog, userId, email, name])

  return null
}
