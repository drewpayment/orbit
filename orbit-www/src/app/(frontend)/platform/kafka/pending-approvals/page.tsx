import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { PlatformPendingApprovalsClient } from './pending-approvals-client'

export default async function PlatformPendingApprovalsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Check if user is platform admin (exists in users collection)
  const user = await payload.findByID({
    collection: 'users',
    id: session.user.id,
    overrideAccess: true,
  })

  if (!user) {
    // Not a platform admin, redirect to home
    redirect('/')
  }

  return (
    <div className="container mx-auto py-6">
      <PlatformPendingApprovalsClient />
    </div>
  )
}
