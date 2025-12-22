import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, LayoutTemplate, Box, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface WorkspaceQuickLinksCardProps {
  workspaceSlug: string
}

export function WorkspaceQuickLinksCard({ workspaceSlug }: WorkspaceQuickLinksCardProps) {
  const links = [
    {
      label: 'All Knowledge Spaces',
      href: `/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge`,
      icon: BookOpen,
    },
    {
      label: 'Templates',
      href: `/templates?workspace=${encodeURIComponent(workspaceSlug)}`,
      icon: LayoutTemplate,
    },
    {
      label: 'Registries',
      href: `/settings/registries?workspace=${encodeURIComponent(workspaceSlug)}`,
      icon: Box,
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quick Links</CardTitle>
        <CardDescription>Helpful shortcuts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <link.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm">{link.label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
