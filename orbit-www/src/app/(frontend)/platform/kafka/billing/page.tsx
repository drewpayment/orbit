import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { PlatformBillingClient } from './client'

export default async function PlatformKafkaBillingPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')

  // For MVP, render with empty initial data
  // Production will fetch from Payload CMS
  return (
    <div className="container py-8">
      <Suspense
        fallback={
          <Card>
            <CardHeader>
              <CardTitle>Loading...</CardTitle>
              <CardDescription>Loading billing data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </CardContent>
          </Card>
        }
      >
        <PlatformBillingClient />
      </Suspense>
    </div>
  )
}
