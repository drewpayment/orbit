'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { getEnv } from '@/lib/env'

/**
 * Tracks page views on Next.js route changes.
 * Wrapped in Suspense because useSearchParams() can suspend.
 */
function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (pathname && ph) {
      let url = window.origin + pathname
      if (searchParams.toString()) {
        url = url + '?' + searchParams.toString()
      }
      ph.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams, ph])

  return null
}

/**
 * PostHog analytics provider.
 *
 * Initializes PostHog client-side with session recording enabled.
 * Designed for self-hosted PostHog — the host URL points to your
 * ingest endpoint (e.g. https://ingest-posthog.example.com).
 *
 * Reads config from runtime env vars (injected via RuntimeEnvScript):
 *   NEXT_PUBLIC_POSTHOG_KEY  — project API key
 *   NEXT_PUBLIC_POSTHOG_HOST — ingest endpoint URL
 *
 * If either is missing, PostHog is not initialized and children
 * render without analytics (zero impact on app behavior).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = getEnv('NEXT_PUBLIC_POSTHOG_KEY')
    const host = getEnv('NEXT_PUBLIC_POSTHOG_HOST')

    if (!key || !host) return

    posthog.init(key, {
      api_host: host,
      person_profiles: 'always',
      capture_pageview: false, // we handle this manually via PostHogPageView
      capture_pageleave: true,
      autocapture: true,
      disable_session_recording: false,
      disable_compression: true, // required: Cloudflare double-gzips if enabled
      loaded: (ph) => {
        ph.startSessionRecording()
      },
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
