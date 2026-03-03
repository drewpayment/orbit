import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { LaunchDetail } from '@/components/features/launches/LaunchDetail'

interface LaunchDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function LaunchDetailPage({ params }: LaunchDetailPageProps) {
  const { id } = await params

  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view this launch</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  let launch
  try {
    launch = await payload.findByID({
      collection: 'launches',
      id,
      depth: 2,
    })
  } catch {
    notFound()
  }

  if (!launch) {
    notFound()
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <LaunchDetail launch={launch as any} currentUserId={session.user.id} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
