'use client'

import { useSession } from '@/lib/auth-client'

interface UsePlatformAdminReturn {
  isPlatformAdmin: boolean
  isSuperAdmin: boolean
  isLoading: boolean
}

/**
 * Hook to check if the current user has platform admin privileges.
 * Derives admin status directly from the session to avoid an extra
 * server round-trip and the layout flash it causes.
 */
export function usePlatformAdmin(): UsePlatformAdminReturn {
  const { data: session, isPending } = useSession()

  const role = (session?.user as Record<string, unknown> | undefined)?.role as string | undefined
  const isPlatformAdmin = role === 'super_admin' || role === 'admin'
  const isSuperAdmin = role === 'super_admin'

  return { isPlatformAdmin, isSuperAdmin, isLoading: isPending }
}
