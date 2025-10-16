'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function WorkspaceKnowledgeLink() {
  const pathname = usePathname()
  
  // Extract workspace ID from the URL
  // URL format: /admin/collections/workspaces/[id]
  const workspaceId = pathname?.split('/').pop()
  
  if (!workspaceId) return null
  
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          <CardTitle>Knowledge Management</CardTitle>
        </div>
        <CardDescription>
          Manage documentation and knowledge bases for this workspace
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={`/admin/collections/workspaces/${workspaceId}/knowledge`}>
          <Button className="w-full">
            View Knowledge Spaces
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
