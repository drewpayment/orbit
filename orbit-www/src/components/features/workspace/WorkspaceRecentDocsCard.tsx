import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, ChevronRight, FolderOpen } from 'lucide-react'
import Link from 'next/link'

interface RecentDoc {
  id: string
  title: string
  spaceSlug: string
  pageSlug: string
}

interface WorkspaceRecentDocsCardProps {
  docs: RecentDoc[]
  workspaceSlug: string
}

export function WorkspaceRecentDocsCard({
  docs,
  workspaceSlug,
}: WorkspaceRecentDocsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href={`/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">
            <FileText className="h-5 w-5" />
            <CardTitle className="text-base">Recent Documents</CardTitle>
          </Link>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link href={`/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge`}>
              <FolderOpen className="h-4 w-4 mr-1" />
              Manage Spaces
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No documents yet</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/new`}>
                Create a knowledge space
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map((doc) => (
              <Link
                key={doc.id}
                href={`/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge/${encodeURIComponent(doc.spaceSlug)}/${encodeURIComponent(doc.pageSlug)}`}
                className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-muted/50 group"
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 text-sm truncate">{doc.title}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
