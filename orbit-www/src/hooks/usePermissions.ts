// orbit-www/src/hooks/usePermissions.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  UserPermissions,
  getStoredPermissions,
  storePermissions,
  clearPermissions,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  hasAllPermissions as checkAllPermissions,
} from '@/lib/permissions'
import { loadUserPermissions } from '@/app/actions/permissions'

interface UsePermissionsReturn {
  permissions: UserPermissions | null
  isLoading: boolean
  hasPermission: (workspaceId: string, permission: string) => boolean
  hasAnyPermission: (workspaceId: string, permissions: string[]) => boolean
  hasAllPermissions: (workspaceId: string, permissions: string[]) => boolean
  refresh: () => Promise<void>
  clear: () => void
}

export function usePermissions(): UsePermissionsReturn {
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load permissions on mount
  useEffect(() => {
    const stored = getStoredPermissions()
    if (stored) {
      setPermissions(stored)
      setIsLoading(false)
    } else {
      // Fetch from server
      loadUserPermissions().then((perms) => {
        if (perms) {
          storePermissions(perms)
          setPermissions(perms)
        }
        setIsLoading(false)
      })
    }
  }, [])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    const perms = await loadUserPermissions()
    if (perms) {
      storePermissions(perms)
      setPermissions(perms)
    }
    setIsLoading(false)
  }, [])

  const clear = useCallback(() => {
    clearPermissions()
    setPermissions(null)
  }, [])

  const hasPermission = useCallback((workspaceId: string, permission: string) => {
    return checkPermission(workspaceId, permission, permissions)
  }, [permissions])

  const hasAnyPermission = useCallback((workspaceId: string, perms: string[]) => {
    return checkAnyPermission(workspaceId, perms, permissions)
  }, [permissions])

  const hasAllPermissions = useCallback((workspaceId: string, perms: string[]) => {
    return checkAllPermissions(workspaceId, perms, permissions)
  }, [permissions])

  return {
    permissions,
    isLoading,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refresh,
    clear,
  }
}
