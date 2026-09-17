import { redirect } from 'next/navigation'
import { getActor } from '@/lib/authz'
import { PlatformPendingApprovalsClient } from './pending-approvals-client'

export default async function PlatformPendingApprovalsPage() {
  const actor = await getActor()
  if (!actor) redirect('/login')

  return (
    <div className="container mx-auto py-6">
      <PlatformPendingApprovalsClient />
    </div>
  )
}
