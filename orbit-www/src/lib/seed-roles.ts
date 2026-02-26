/**
 * Shared permissions and roles seed logic.
 * Used by both the initial setup flow and the standalone seed script.
 */
import type { Payload } from 'payload'

const PERMISSIONS = [
  // Template permissions
  { slug: 'template:create', name: 'Create Templates', description: 'Import/register new templates from GitHub repos', category: 'template', scope: 'workspace' },
  { slug: 'template:publish', name: 'Publish Templates', description: 'Change template visibility to shared/public', category: 'template', scope: 'workspace' },
  { slug: 'template:manage', name: 'Manage Templates', description: 'Edit, archive, and delete templates', category: 'template', scope: 'workspace' },

  // Repository permissions
  { slug: 'repository:create', name: 'Create Repositories', description: 'Create new repositories', category: 'repository', scope: 'workspace' },
  { slug: 'repository:update', name: 'Update Repositories', description: 'Edit repository metadata', category: 'repository', scope: 'workspace' },
  { slug: 'repository:delete', name: 'Delete Repositories', description: 'Delete repositories', category: 'repository', scope: 'workspace' },
  { slug: 'repository:admin', name: 'Administer Repositories', description: 'Full repository control', category: 'repository', scope: 'workspace' },

  // Workspace permissions
  { slug: 'workspace:manage', name: 'Manage Workspace', description: 'Edit workspace settings', category: 'workspace', scope: 'workspace' },
  { slug: 'workspace:invite', name: 'Invite Members', description: 'Invite users to workspace', category: 'workspace', scope: 'workspace' },
  { slug: 'workspace:settings', name: 'Workspace Settings', description: 'Configure workspace settings', category: 'workspace', scope: 'workspace' },

  // Knowledge permissions
  { slug: 'knowledge:create', name: 'Create Knowledge', description: 'Create knowledge pages', category: 'knowledge', scope: 'workspace' },
  { slug: 'knowledge:publish', name: 'Publish Knowledge', description: 'Publish knowledge pages', category: 'knowledge', scope: 'workspace' },
  { slug: 'knowledge:admin', name: 'Administer Knowledge', description: 'Full knowledge control', category: 'knowledge', scope: 'workspace' },

  // Platform permissions
  { slug: 'admin:impersonate', name: 'Impersonate Users', description: 'Act as another user', category: 'admin', scope: 'platform' },
  { slug: 'admin:tenants', name: 'Manage Tenants', description: 'Manage all tenants', category: 'admin', scope: 'platform' },
] as const

const ROLES: Array<{
  slug: string
  name: string
  description: string
  scope: 'workspace' | 'platform'
  isSystem: boolean
  isDefault: boolean
  permissionSlugs: readonly string[]
}> = [
  {
    slug: 'super-admin',
    name: 'Super Admin',
    description: 'Full platform access',
    scope: 'platform',
    isSystem: true,
    isDefault: false,
    permissionSlugs: PERMISSIONS.map(p => p.slug),
  },
  {
    slug: 'workspace-owner',
    name: 'Workspace Owner',
    description: 'Full workspace control',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [
      'template:create', 'template:publish', 'template:manage',
      'repository:create', 'repository:update', 'repository:delete', 'repository:admin',
      'workspace:manage', 'workspace:invite', 'workspace:settings',
      'knowledge:create', 'knowledge:publish', 'knowledge:admin',
    ],
  },
  {
    slug: 'workspace-admin',
    name: 'Workspace Admin',
    description: 'Workspace administration',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [
      'template:create', 'template:publish', 'template:manage',
      'repository:create', 'repository:update', 'repository:delete',
      'workspace:invite', 'workspace:settings',
      'knowledge:create', 'knowledge:publish', 'knowledge:admin',
    ],
  },
  {
    slug: 'workspace-member',
    name: 'Workspace Member',
    description: 'Standard workspace access',
    scope: 'workspace',
    isSystem: true,
    isDefault: true,
    permissionSlugs: [
      'template:create',
      'repository:create', 'repository:update',
      'knowledge:create', 'knowledge:publish',
    ],
  },
  {
    slug: 'workspace-viewer',
    name: 'Workspace Viewer',
    description: 'Read-only access',
    scope: 'workspace',
    isSystem: true,
    isDefault: false,
    permissionSlugs: [],
  },
]

/**
 * Seeds all permissions and roles into the database.
 * Idempotent — safe to run multiple times.
 *
 * @returns The Payload ID of the super-admin role (for assigning to users).
 */
export async function seedPermissionsAndRoles(payload: Payload): Promise<{ superAdminRoleId: string }> {
  // Create permissions
  const permissionMap = new Map<string, string>()

  for (const perm of PERMISSIONS) {
    const existing = await payload.find({
      collection: 'permissions',
      where: { slug: { equals: perm.slug } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'permissions',
        data: perm,
        overrideAccess: true,
      })
      permissionMap.set(perm.slug, String(created.id))
    } else {
      permissionMap.set(perm.slug, String(existing.docs[0].id))
    }
  }

  // Create roles
  let superAdminRoleId = ''

  for (const role of ROLES) {
    const existing = await payload.find({
      collection: 'roles',
      where: { slug: { equals: role.slug } },
      limit: 1,
      overrideAccess: true,
    })

    const permissionIds = role.permissionSlugs
      .map(slug => permissionMap.get(slug))
      .filter((id): id is string => !!id)

    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'roles',
        data: {
          slug: role.slug,
          name: role.name,
          description: role.description,
          scope: role.scope,
          isSystem: role.isSystem,
          isDefault: role.isDefault,
          permissions: permissionIds,
        },
        overrideAccess: true,
      })
      if (role.slug === 'super-admin') {
        superAdminRoleId = String(created.id)
      }
    } else {
      // Update existing role with current permissions
      await payload.update({
        collection: 'roles',
        id: existing.docs[0].id,
        data: { permissions: permissionIds },
        overrideAccess: true,
      })
      if (role.slug === 'super-admin') {
        superAdminRoleId = String(existing.docs[0].id)
      }
    }
  }

  return { superAdminRoleId }
}

/**
 * Assigns the super-admin role to a user (platform-level, no workspace).
 * Idempotent — skips if already assigned.
 */
export async function assignSuperAdmin(payload: Payload, userId: string, superAdminRoleId: string): Promise<void> {
  // Check if already assigned
  const existing = await payload.find({
    collection: 'user-workspace-roles',
    where: {
      and: [
        { user: { equals: userId } },
        { role: { equals: superAdminRoleId } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) return

  await payload.create({
    collection: 'user-workspace-roles',
    data: {
      user: userId,
      role: superAdminRoleId,
      // workspace intentionally omitted — platform-level role
    },
    overrideAccess: true,
  })
}
