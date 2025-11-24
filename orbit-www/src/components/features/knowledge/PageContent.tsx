'use client'

import { useState } from 'react'
import { PageEditor } from './PageEditor'
import type { KnowledgePage } from '@/payload-types'
import type { BlockDocument } from '@/lib/blocks/types'

interface PageContentProps {
  page: KnowledgePage
  author: any
  lastEditedBy: any
  onSave: (content: BlockDocument) => Promise<void>
}

export function PageContent({ page, author, lastEditedBy, onSave }: PageContentProps) {
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')

  return (
    <>
      {/* Page Title & Metadata */}
      <div className="mb-8 pb-8 border-b border-border/40 stagger-item">
        {/* Title */}
        <h1 className="text-[3.5rem] font-bold font-serif-display leading-tight mb-8">
          {page.title}
        </h1>

        {/* Metadata line with save status */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground font-medium">
            {author && <span>By {author.name || author.email}</span>}
            {author && page.updatedAt && <span>·</span>}
            {page.updatedAt && (
              <span>
                Updated{' '}
                {new Date(page.updatedAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            )}
            {lastEditedBy && lastEditedBy.id !== author?.id && (
              <>
                <span>·</span>
                <span>Last edited by {lastEditedBy.name || lastEditedBy.email}</span>
              </>
            )}
          </div>

          {/* Save status indicator */}
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Saved
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Page Content - always-on editor */}
      <div className="stagger-item">
        <PageEditor
          page={page}
          canEdit={true}
          onSave={onSave}
          onStatusChange={setSaveStatus}
        />
      </div>
    </>
  )
}
