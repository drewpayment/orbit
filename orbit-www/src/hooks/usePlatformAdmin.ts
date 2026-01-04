'use client'

import { useState, useEffect } from 'react'
import { checkPlatformAdmin } from '@/app/actions/platform'

interface UsePlatformAdminReturn {
  isPlatformAdmin: boolean
  isLoading: boolean
}

/**
 * Hook to check if the current user has platform admin privileges.
 * Platform admins have access to platform-level settings like Kafka clusters,
 * providers, and environment mappings.
 */
export function usePlatformAdmin(): UsePlatformAdminReturn {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    checkPlatformAdmin()
      .then((result) => {
        if (mounted) {
          setIsPlatformAdmin(result.isAdmin)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (mounted) {
          setIsPlatformAdmin(false)
          setIsLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  return { isPlatformAdmin, isLoading }
}
