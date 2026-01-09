import { Suspense } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PlatformBillingClient } from './client'

export default async function PlatformKafkaBillingPage() {
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
