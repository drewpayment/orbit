import { redirect } from 'next/navigation'
import { getActor, check } from '@/lib/authz'
import { PlatformPendingApprovalsClient } from './pending-approvals-client'

export default async function PlatformPendingApprovalsPage() {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const d = await check('manage', { kind: 'platform' }, actor)
  if (!d.allowed) redirect('/')

  return (
    <div className="container mx-auto py-6">
      <PlatformPendingApprovalsClient />
    </div>
  )
}
