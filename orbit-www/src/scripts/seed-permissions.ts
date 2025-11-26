// orbit-www/src/scripts/seed-permissions.ts
import { getPayload } from 'payload'
import config from '@payload-config'

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

const ROLES = [
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

async function seed() {
  const payload = await getPayload({ config })

  console.log('Seeding permissions...')

  // Create permissions
  const permissionMap = new Map<string, string | number>()

  for (const perm of PERMISSIONS) {
    const existing = await payload.find({
      collection: 'permissions',
      where: { slug: { equals: perm.slug } },
      limit: 1,
    })

    if (existing.docs.length === 0) {
      const created = await payload.create({
        collection: 'permissions',
        data: perm,
      })
      permissionMap.set(perm.slug, created.id)
      console.log(`  Created permission: ${perm.slug}`)
    } else {
      permissionMap.set(perm.slug, existing.docs[0].id)
      console.log(`  Exists: ${perm.slug}`)
    }
  }

  console.log('Seeding roles...')

  // Create roles
  for (const role of ROLES) {
    const existing = await payload.find({
      collection: 'roles',
      where: { slug: { equals: role.slug } },
      limit: 1,
    })

    const permissionIds = role.permissionSlugs
      .map(slug => permissionMap.get(slug))
      .filter((id): id is string | number => !!id)

    if (existing.docs.length === 0) {
      await payload.create({
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
      })
      console.log(`  Created role: ${role.slug}`)
    } else {
      // Update existing role with current permissions
      await payload.update({
        collection: 'roles',
        id: existing.docs[0].id,
        data: {
          permissions: permissionIds,
        },
      })
      console.log(`  Updated role: ${role.slug}`)
    }
  }

  console.log('Seed complete!')
  process.exit(0)
}

seed().catch(console.error)
