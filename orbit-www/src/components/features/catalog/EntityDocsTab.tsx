'use client'

import Link from 'next/link'
import { FileText, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { LinkedDoc } from '@/app/(frontend)/catalog/[id]/actions'

interface EntityDocsTabProps {
  docs: LinkedDoc[]
  /** The entity slug used to link docs — surfaced so the empty state can hint how. */
  entitySlug?: string | null
}

/**
 * Knowledge pages have no first-class relation to catalog entities, so a page is
 * considered "linked" when it's tagged with the entity's slug (see actions.ts).
 * When nothing matches we show a clear, actionable empty state rather than an
 * over-engineered linking UI.
 */
export function EntityDocsTab({ docs, entitySlug }: EntityDocsTabProps) {
  if (docs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No docs linked yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {entitySlug
              ? `Tag a published knowledge page with "${entitySlug}" to surface it here.`
              : 'This entity has no slug, so knowledge pages can’t be auto-linked yet.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {docs.map((doc) => (
        <Link
          key={doc.id}
          href="/knowledge"
          className="flex items-center gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-muted"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{doc.title}</div>
            {doc.spaceName && (
              <div className="truncate text-xs text-muted-foreground">{doc.spaceName}</div>
            )}
          </div>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}
