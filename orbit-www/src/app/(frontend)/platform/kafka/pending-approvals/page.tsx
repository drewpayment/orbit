import { redirect } from 'next/navigation'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { PlatformPendingApprovalsClient } from './pending-approvals-client'

export default async function PlatformPendingApprovalsPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')

  return (
    <div className="container mx-auto py-6">
      <PlatformPendingApprovalsClient />
    </div>
  )
}
