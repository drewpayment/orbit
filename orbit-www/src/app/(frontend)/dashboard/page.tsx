'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

interface Workspace {
  id: string
  name: string
  slug: string
  description?: string
  avatar?: string
}

export default function DashboardPage() {
  const router = useRouter()
  const { data: session, isPending } = useSession()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isPending && !session) {
      router.push('/login')
    }
  }, [session, isPending, router])

  useEffect(() => {
    if (session) {
      fetchWorkspaces()
    }
  }, [session])

  const fetchWorkspaces = async () => {
    try {
      const response = await fetch('/api/workspaces')
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.docs || [])
      }
    } catch (error) {
      console.error('Failed to fetch workspaces:', error)
    } finally {
      setLoading(false)
    }
  }

  if (isPending || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="[--header-height:calc(theme(spacing.14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar className="pt-11" />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-4 p-8">
              <div className="mb-8">
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                  Welcome to Orbit
                </h1>
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  Your organization&apos;s Internal Developer Portal
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
                <Card>
                  <CardHeader>
                    <CardTitle>Getting Started</CardTitle>
                    <CardDescription>
                      Learn how to use Orbit for your team
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      <li>• Browse existing workspaces</li>
                      <li>• Request to join a workspace</li>
                      <li>• Create your own workspace</li>
                      <li>• Explore team documentation</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>
                      Common tasks and shortcuts
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button asChild className="w-full">
                      <Link href="/workspaces/new">Create Workspace</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/workspaces">Browse Workspaces</Link>
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Resources</CardTitle>
                    <CardDescription>
                      Documentation and support
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      <li>
                        <a href="#" className="text-blue-600 hover:underline dark:text-blue-400">
                          Platform Documentation
                        </a>
                      </li>
                      <li>
                        <a href="#" className="text-blue-600 hover:underline dark:text-blue-400">
                          API Reference
                        </a>
                      </li>
                      <li>
                        <a href="#" className="text-blue-600 hover:underline dark:text-blue-400">
                          Support Portal
                        </a>
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Available Workspaces
                  </h2>
                  <Button asChild>
                    <Link href="/workspaces">View All</Link>
                  </Button>
                </div>

                {loading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
                  </div>
                ) : workspaces.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-gray-600 dark:text-gray-400">
                        No workspaces available yet. Be the first to create one!
                      </p>
                      <Button asChild className="mt-4">
                        <Link href="/workspaces/new">Create Workspace</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {workspaces.slice(0, 6).map((workspace) => (
                      <Card key={workspace.id} className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                          <CardTitle className="text-lg">{workspace.name}</CardTitle>
                          <CardDescription>/{workspace.slug}</CardDescription>
                        </CardHeader>
                        {workspace.description && (
                          <CardContent>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {workspace.description}
                            </p>
                          </CardContent>
                        )}
                        <CardContent>
                          <Button asChild variant="outline" className="w-full">
                            <Link href={`/workspaces/${workspace.slug}`}>View Workspace</Link>
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  )
}
