import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

import type { UserRole } from './policy'
import { getEmailVerifiedMap } from './get-email-verified'
import { UsersTable, type UserRow } from './users-table'

export const metadata = {
  title: 'Users — Platform Admin',
  description: 'Create and manage platform users, roles, and registration approvals',
}

export default async function PlatformUsersPage() {
  const actor = await getPayloadUserFromSession()
  if (!actor) redirect('/login')
  if (!isPlatformAdmin(actor)) redirect('/')

  const payload = await getPayload({ config })

  // Fetch users with overrideAccess so the admin sees the full set. limit: 500
  // is a deliberate cap — this page has no pagination yet; if an install grows
  // past it, the newest 500 show and this needs real pagination (tracked as
  // follow-up, not built here).
  const USERS_PAGE_CAP = 500
  const usersResult = await payload.find({
    collection: 'users',
    sort: '-createdAt',
    limit: USERS_PAGE_CAP,
    depth: 1,
    overrideAccess: true,
  })

  const verifiedMap = await getEmailVerifiedMap(usersResult.docs.map((d) => d.email))

  const users: UserRow[] = usersResult.docs.map((doc) => {
    const avatar = doc.avatar
    const avatarUrl =
      avatar && typeof avatar === 'object' && 'url' in avatar
        ? ((avatar as { url?: string | null }).url ?? null)
        : null
    return {
      id: String(doc.id),
      name: doc.name ?? '',
      email: doc.email,
      role: (doc.role ?? 'user') as UserRole,
      status: (doc.status ?? 'pending') as UserRow['status'],
      emailVerified: verifiedMap.get(doc.email.toLowerCase()) ?? false,
      avatarUrl,
      createdAt: doc.createdAt,
      invitedAt: doc.invitedAt ?? null,
    }
  })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="container mx-auto py-8 px-6 max-w-6xl space-y-6">
          <UsersTable
            users={users}
            actorId={String(actor.id)}
            actorRole={(actor.role ?? 'user') as UserRole}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
