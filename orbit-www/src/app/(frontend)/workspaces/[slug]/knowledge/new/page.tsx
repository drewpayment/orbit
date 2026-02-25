'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { createKnowledgeSpace } from '@/app/actions/knowledge'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default function NewKnowledgeSpacePage({ params }: PageProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'internal' | 'public'>('internal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (name.trim().length < 3) {
      setError('Name must be at least 3 characters')
      return
    }

    setIsSubmitting(true)

    try {
      const { slug: workspaceSlug } = await params

      const space = await createKnowledgeSpace({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon.trim() || undefined,
        visibility,
        workspaceSlug,
      })

      router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create knowledge space')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto max-w-2xl">
            <div className="mb-6">
              <Button variant="ghost" size="sm" asChild>
                <Link href="#" onClick={(e) => { e.preventDefault(); router.back() }}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Link>
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Create Knowledge Space</CardTitle>
                <CardDescription>
                  A knowledge space organizes documentation, guides, and other content for your workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Engineering Docs"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What is this knowledge space about?"
                      rows={3}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="icon">Icon</Label>
                    <Input
                      id="icon"
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      placeholder="e.g., 📚 or book"
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter an emoji or icon name (book, docs, guide, wiki, notes)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="visibility">Visibility</Label>
                    <Select
                      value={visibility}
                      onValueChange={(v) => setVisibility(v as typeof visibility)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">Private — Only you</SelectItem>
                        <SelectItem value="internal">Internal — Workspace members</SelectItem>
                        <SelectItem value="public">Public — Anyone</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}

                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create Space
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
