// orbit-www/src/lib/permissions.ts

export interface UserPermissions {
  workspaces: {
    [workspaceId: string]: {
      roles: string[]
      permissions: string[]
    }
  }
  platformPermissions: string[]
}

const PERMISSIONS_KEY = 'orbit_permissions'

/**
 * Store user permissions in sessionStorage
 */
export function storePermissions(permissions: UserPermissions): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions))
}

/**
 * Get user permissions from sessionStorage
 */
export function getStoredPermissions(): UserPermissions | null {
  if (typeof window === 'undefined') return null
  const stored = sessionStorage.getItem(PERMISSIONS_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as UserPermissions
  } catch {
    return null
  }
}

/**
 * Clear stored permissions (on logout)
 */
export function clearPermissions(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(PERMISSIONS_KEY)
}

/**
 * Check if user has a specific permission in a workspace
 */
export function hasPermission(
  workspaceId: string,
  permission: string,
  permissions?: UserPermissions | null
): boolean {
  const perms = permissions ?? getStoredPermissions()
  if (!perms) return false

  // Check platform permissions first (super admin)
  if (perms.platformPermissions.includes(permission)) return true
  if (perms.platformPermissions.includes('*')) return true

  // Check workspace permissions
  const workspace = perms.workspaces[workspaceId]
  if (!workspace) return false

  return workspace.permissions.includes(permission)
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  workspaceId: string,
  requiredPermissions: string[],
  permissions?: UserPermissions | null
): boolean {
  return requiredPermissions.some(p => hasPermission(workspaceId, p, permissions))
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
  workspaceId: string,
  requiredPermissions: string[],
  permissions?: UserPermissions | null
): boolean {
  return requiredPermissions.every(p => hasPermission(workspaceId, p, permissions))
}

/**
 * Get all workspaces user has access to
 */
export function getAccessibleWorkspaces(permissions?: UserPermissions | null): string[] {
  const perms = permissions ?? getStoredPermissions()
  if (!perms) return []
  return Object.keys(perms.workspaces)
}
