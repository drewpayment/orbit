# Editorial Page Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the knowledge page editor into a seamless, always-on editorial experience with beautiful typography, generous whitespace, and integrated navigation.

**Architecture:** Remove edit/read mode toggle for always-on editing, apply editorial serif fonts scoped to content blocks, implement auto-hide sidebar with backdrop blur, simplify layout by removing cards/borders, add staggered reveal animations.

**Tech Stack:** React 19, Next.js 15, TypeScript, Tailwind CSS, TipTap/Novel editor, Radix UI

---

## Task 1: Add Editorial Serif Fonts

**Goal:** Import and configure Crimson Pro and Charter serif fonts for editorial typography.

**Files:**
- Modify: `orbit-www/src/app/layout.tsx:1-20` (add font imports)
- Modify: `orbit-www/src/app/globals.css:115-123` (add font-face declarations)
- Modify: `orbit-www/tailwind.config.ts:8-15` (extend font family)

**Step 1: Add font imports to layout.tsx**

Location: `orbit-www/src/app/layout.tsx`

Add imports after existing font imports:

```typescript
import { Crimson_Pro, Source_Serif_4 } from 'next/font/google'

const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-crimson-pro',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-serif',
  display: 'swap',
})
```

Update body className to include font variables:

```typescript
<body className={`${geistSans.variable} ${geistMono.variable} ${crimsonPro.variable} ${sourceSerif.variable}`}>
```

**Step 2: Verify fonts load**

Run: `cd orbit-www && bun run dev`
Open: `http://localhost:3000`
Check browser DevTools → Network → Fonts tab
Expected: See crimson-pro and source-serif-4 font files loaded

**Step 3: Update Tailwind config to include serif fonts**

Location: `orbit-www/tailwind.config.ts`

Add to theme.extend.fontFamily:

```typescript
fontFamily: {
  sans: ['var(--font-geist-sans)'],
  mono: ['var(--font-geist-mono)'],
  'serif-display': ['var(--font-crimson-pro)', 'Georgia', 'serif'],
  'serif-body': ['var(--font-source-serif)', 'Charter', 'Georgia', 'serif'],
},
```

**Step 4: Commit font setup**

```bash
git add orbit-www/src/app/layout.tsx orbit-www/tailwind.config.ts
git commit -m "feat(editor): add editorial serif fonts (Crimson Pro, Source Serif)

- Import Crimson Pro for display typography
- Import Source Serif 4 for body content
- Configure font-display: swap for performance
- Extend Tailwind with serif font families

Part of editorial page editor redesign.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create Always-On Editor Component

**Goal:** Simplify PageEditor to always render the editor (no mode toggle).

**Files:**
- Modify: `orbit-www/src/components/features/knowledge/PageEditor.tsx:1-242`
- Test: Manual verification (component tests require app router setup)

**Step 1: Write test for always-on editor behavior**

Location: `orbit-www/src/components/features/knowledge/PageEditor.test.tsx`

Create new test file:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageEditor } from './PageEditor'
import type { KnowledgePage } from '@/payload-types'

// Mock NovelEditor component
vi.mock('@/components/editor/NovelEditor', () => ({
  NovelEditor: ({ initialContent, onChange }: any) => (
    <div data-testid="novel-editor">
      <div data-testid="editor-content">{JSON.stringify(initialContent)}</div>
    </div>
  ),
}))

describe('PageEditor - Always-On Mode', () => {
  const mockPage: Partial<KnowledgePage> = {
    id: 'test-page',
    title: 'Test Page',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Test content' }],
        },
      ],
    },
  }

  const mockOnSave = vi.fn()

  it('should always render NovelEditor when canEdit is true', () => {
    render(
      <PageEditor
        page={mockPage as KnowledgePage}
        canEdit={true}
        onSave={mockOnSave}
      />
    )

    expect(screen.getByTestId('novel-editor')).toBeInTheDocument()
  })

  it('should render read-only view when canEdit is false', () => {
    render(
      <PageEditor
        page={mockPage as KnowledgePage}
        canEdit={false}
        onSave={mockOnSave}
      />
    )

    // Should show serialized content, not editor
    expect(screen.queryByTestId('novel-editor')).not.toBeInTheDocument()
  })

  it('should show empty state when content is empty and canEdit is true', () => {
    const emptyPage = {
      ...mockPage,
      content: { type: 'doc', content: [] },
    }

    render(
      <PageEditor
        page={emptyPage as KnowledgePage}
        canEdit={true}
        onSave={mockOnSave}
      />
    )

    expect(screen.getByText(/start writing/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && NODE_OPTIONS=--no-deprecation bun run vitest run src/components/features/knowledge/PageEditor.test.tsx`
Expected: FAIL - test file doesn't exist yet

**Step 3: Implement always-on PageEditor**

Location: `orbit-www/src/components/features/knowledge/PageEditor.tsx`

Replace entire file with:

```typescript
'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { NovelEditor } from '@/components/editor/NovelEditor'
import { serializeBlocks } from '@/lib/serializers/blocks-to-react'
import type { BlockDocument } from '@/lib/blocks/types'
import type { KnowledgePage } from '@/payload-types'

interface PageEditorProps {
  page: KnowledgePage
  canEdit: boolean
  onSave: (content: BlockDocument) => Promise<void>
}

export function PageEditor({ page, canEdit, onSave }: PageEditorProps) {
  // Ensure initial content is pure JSON without MongoDB properties
  const initialContent = useMemo(
    () => JSON.parse(JSON.stringify(page.content)) as BlockDocument,
    [page.content]
  )

  const [content, setContent] = useState<BlockDocument>(initialContent)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef<string>(JSON.stringify(initialContent))
  const currentContentRef = useRef<BlockDocument>(initialContent)

  // Auto-save function
  const performSave = useCallback(async (contentToSave: BlockDocument) => {
    const contentString = JSON.stringify(contentToSave)

    // Don't save if content hasn't changed
    if (contentString === lastSavedContentRef.current) {
      return
    }

    setSaveStatus('saving')

    try {
      const pureContent = JSON.parse(contentString) as BlockDocument
      await onSave(pureContent)
      lastSavedContentRef.current = contentString
      setSaveStatus('saved')
    } catch (error) {
      console.error('Failed to save:', error)
      setSaveStatus('unsaved')
    }
  }, [onSave])

  // Handle content changes with debounced auto-save
  const handleChange = useCallback((newContent: BlockDocument) => {
    setContent(newContent)
    currentContentRef.current = newContent
    setSaveStatus('unsaved')

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for auto-save (2 seconds)
    saveTimeoutRef.current = setTimeout(() => {
      performSave(newContent)
    }, 2000)
  }, [performSave])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Check if content is empty
  const isEmpty = !content.content || content.content.length === 0 ||
    (content.content.length === 1 &&
      content.content[0].type === 'paragraph' &&
      (!content.content[0].content || content.content[0].content.length === 0))

  // If user can't edit, show read-only view
  if (!canEdit) {
    return (
      <div className="page-content px-12 py-8">
        <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none dark:prose-invert font-serif-body">
          {serializeBlocks(content)}
        </div>
      </div>
    )
  }

  // Always-on editor for users who can edit
  return (
    <div className="page-editor">
      {/* Auto-save indicator */}
      <div className="mb-3 flex items-center justify-end">
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

      {/* Editor or empty state */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center rounded-lg border border-dashed border-border">
          <div className="mb-4 text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2">
            Start writing
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Click to start editing. Press{' '}
            <kbd className="px-2 py-1 text-xs font-semibold bg-secondary border border-border rounded">
              /
            </kbd>{' '}
            for commands
          </p>
        </div>
      ) : (
        <NovelEditor
          initialContent={content}
          onChange={handleChange}
          onBlur={() => {
            // Save immediately on blur if there are unsaved changes
            if (saveStatus === 'unsaved' && saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current)
              performSave(currentContentRef.current)
            }
          }}
        />
      )}
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && NODE_OPTIONS=--no-deprecation bun run vitest run src/components/features/knowledge/PageEditor.test.tsx`
Expected: PASS (3/3 tests)

**Step 5: Commit always-on editor**

```bash
git add orbit-www/src/components/features/knowledge/PageEditor.tsx orbit-www/src/components/features/knowledge/PageEditor.test.tsx
git commit -m "feat(editor): implement always-on editing mode

- Remove edit/read mode toggle complexity
- Always render NovelEditor when canEdit=true
- Show read-only serialized content when canEdit=false
- Maintain auto-save with debouncing
- Add empty state with dashed border
- Apply serif fonts to read-only content

Breaking change: No more click-to-edit pattern.
Users with edit permissions see live editor immediately.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Simplify Page Layout Structure

**Goal:** Remove Card wrappers, borders, and cramped padding from page layout.

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx:133-307`

**Step 1: Update page layout to remove containers**

Location: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Replace the return statement (lines 133-307) with:

```typescript
return (
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <SiteHeader />

      {/* Slim header with breadcrumbs - 40px height */}
      <div className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-border bg-background px-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href={`/workspaces/${workspace.slug}/knowledge`}
            className="hover:text-foreground transition-colors"
          >
            Knowledge Base
          </Link>
          <span>/</span>
          <Link
            href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
            className="hover:text-foreground transition-colors"
          >
            {space.name}
          </Link>
          <span>/</span>
          <span className="text-foreground">{page.title}</span>
        </div>
      </div>

      {/* Main content - full width with generous padding */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-none px-48 py-16">
          <article className="stagger-reveal">
            {/* Page Title & Metadata */}
            <div className="mb-12 stagger-item">
              {/* Status badges */}
              {(page.status === 'draft' || page.status === 'archived') && (
                <div className="mb-4">
                  {page.status === 'draft' && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                    >
                      Draft
                    </Badge>
                  )}
                  {page.status === 'archived' && (
                    <Badge
                      variant="secondary"
                      className="bg-muted text-muted-foreground"
                    >
                      Archived
                    </Badge>
                  )}
                </div>
              )}

              {/* Title - large serif, will be first editable block in editor */}
              <h1 className="text-[3.5rem] font-bold font-serif-display leading-tight mb-8">
                {page.title}
              </h1>

              {/* Metadata line - inline, subtle */}
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
            </div>

            {/* Page Content - always-on editor */}
            <div className="mb-16 stagger-item">
              <PageEditor
                page={page}
                canEdit={true}
                onSave={boundUpdatePage}
              />
            </div>

            {/* Tags - inline presentation */}
            {page.tags && page.tags.length > 0 && (
              <div className="mb-16 stagger-item">
                <div className="text-sm text-muted-foreground mb-3">Tagged with</div>
                <div className="flex flex-wrap gap-2">
                  {page.tags.map((tag, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="rounded-full px-4 py-1"
                    >
                      {typeof tag === 'string' ? tag : tag.tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Child Pages - clean list */}
            {page.childPages && page.childPages.length > 0 && (
              <div className="stagger-item">
                <h3 className="text-xl font-semibold font-serif-display mb-6">
                  Pages within {page.title}
                </h3>
                <div className="space-y-4">
                  {page.childPages.map((childPage) => {
                    const child = typeof childPage === 'object' ? childPage : null
                    if (!child) return null

                    return (
                      <Link
                        key={child.id}
                        href={`/workspaces/${workspace.slug}/knowledge/${space.slug}/${child.slug}`}
                        className="block group"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="text-foreground font-serif-body group-hover:underline">
                            {child.title}
                          </span>
                          {child.status === 'draft' && (
                            <span className="text-xs text-muted-foreground">
                              (Draft)
                            </span>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
)
```

**Step 2: Remove unused imports**

At the top of the file, remove these imports (no longer needed):

```typescript
// REMOVE:
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'
import { Calendar, User, FileText } from 'lucide-react'
```

**Step 3: Verify page renders without errors**

Run: `cd orbit-www && bun run dev`
Open: `http://localhost:3000/workspaces/[your-workspace]/knowledge/[space]/[page]`
Expected: Page loads without Card borders, generous padding visible

**Step 4: Commit layout simplification**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx
git commit -m "feat(editor): simplify page layout and remove visual clutter

- Remove Card wrappers around all sections
- Remove Separator components
- Increase horizontal padding to 12rem (48 in Tailwind)
- Add slim 40px header with breadcrumbs
- Apply serif fonts to title and child pages
- Inline metadata presentation with subtle styling
- Remove SpaceNavigator (will be in auto-hide sidebar)

Layout now feels spacious and editorial.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Staggered Reveal Animations

**Goal:** Add subtle staggered fade-in animations on page load.

**Files:**
- Modify: `orbit-www/src/app/globals.css:115-180` (add animation keyframes)
- Test: Visual verification in browser

**Step 1: Add animation keyframes and classes to globals.css**

Location: `orbit-www/src/app/globals.css`

Add after the `@layer base` block:

```css
@layer utilities {
  /* Staggered reveal animations */
  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .stagger-reveal {
    /* Container for staggered items */
  }

  .stagger-item {
    opacity: 0;
    animation: fade-in 400ms ease-out forwards;
  }

  /* Stagger delays */
  .stagger-item:nth-child(1) {
    animation: fade-up 400ms ease-out forwards;
    animation-delay: 0ms;
  }

  .stagger-item:nth-child(2) {
    animation-delay: 100ms;
  }

  .stagger-item:nth-child(3) {
    animation-delay: 200ms;
  }

  .stagger-item:nth-child(4) {
    animation-delay: 300ms;
  }

  .stagger-item:nth-child(5) {
    animation-delay: 400ms;
  }

  /* Remaining items appear instantly */
  .stagger-item:nth-child(n+6) {
    animation-delay: 0ms;
    opacity: 1;
  }
}
```

**Step 2: Verify animations in browser**

Run: `cd orbit-www && bun run dev`
Open: Page and hard refresh (Cmd+Shift+R)
Expected: Title fades up first, then metadata, then content stagger in

**Step 3: Commit animations**

```bash
git add orbit-www/src/app/globals.css
git commit -m "feat(editor): add staggered reveal animations on page load

- Title fades up from below (translateY)
- Subsequent sections fade in with 100ms stagger
- Max 5 items animated, rest appear instantly
- 400ms duration with ease-out timing
- CSS-only for performance

Subtle polish that makes the page feel premium.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Responsive Padding Adjustments

**Goal:** Adjust padding for mobile/tablet to prevent cramped layout.

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx:142`

**Step 1: Update padding to be responsive**

Location: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Change line 142 from:

```typescript
<div className="mx-auto max-w-none px-48 py-16">
```

To:

```typescript
<div className="mx-auto max-w-none px-6 sm:px-12 lg:px-24 xl:px-48 py-8 sm:py-12 lg:py-16">
```

**Step 2: Test on different screen sizes**

Run: `cd orbit-www && bun run dev`
Open browser DevTools responsive mode
Test breakpoints:
- Mobile (375px): 1.5rem (24px) padding
- Tablet (768px): 3rem (48px) padding
- Desktop (1024px): 6rem (96px) padding
- XL (1280px): 12rem (192px) padding

Expected: Content never touches edges, comfortable reading width

**Step 3: Commit responsive padding**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx
git commit -m "feat(editor): add responsive padding for all screen sizes

Mobile: 1.5rem horizontal padding
Tablet: 3rem horizontal padding
Desktop: 6rem horizontal padding
XL: 12rem horizontal padding

Vertical padding also scales responsively.
Ensures comfortable reading on all devices.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Apply Editorial Typography to NovelEditor Content

**Goal:** Style the TipTap editor content blocks with serif fonts.

**Files:**
- Modify: `orbit-www/src/components/editor/NovelEditor.tsx:1-150` (add prose classes)
- Modify: `orbit-www/src/app/globals.css:180-220` (add prose customization)

**Step 1: Add custom prose styles to globals.css**

Location: `orbit-www/src/app/globals.css`

Add after the stagger animations:

```css
@layer components {
  /* Editorial typography for editor content */
  .prose-editorial {
    @apply prose prose-lg max-w-none;
  }

  .prose-editorial h1,
  .prose-editorial h2,
  .prose-editorial h3,
  .prose-editorial h4 {
    @apply font-serif-display;
  }

  .prose-editorial p,
  .prose-editorial li,
  .prose-editorial blockquote {
    @apply font-serif-body text-[1.125rem] leading-[1.7];
  }

  .prose-editorial code {
    @apply font-mono;
  }

  .prose-editorial a {
    @apply text-primary hover:underline;
  }

  /* Dark mode adjustments */
  .dark .prose-editorial {
    @apply prose-invert;
  }
}
```

**Step 2: Update NovelEditor wrapper with prose class**

Location: `orbit-www/src/components/editor/NovelEditor.tsx`

Find the EditorRoot wrapper and add prose-editorial class:

```typescript
<EditorRoot>
  <div className="prose-editorial">
    <EditorContent
      className="novel-editor"
      editor={editor}
    />
  </div>
</EditorRoot>
```

(Note: Exact implementation depends on Novel's structure - may need to check current NovelEditor.tsx)

**Step 3: Verify serif fonts in editor**

Run: `cd orbit-www && bun run dev`
Open editor, type some content
Expected: Headings use Crimson Pro, paragraphs use Source Serif

**Step 4: Commit editorial typography**

```bash
git add orbit-www/src/app/globals.css orbit-www/src/components/editor/NovelEditor.tsx
git commit -m "feat(editor): apply editorial serif typography to content

- Headings use Crimson Pro display font
- Body text uses Source Serif with 1.125rem size
- Line height 1.7 for optimal readability
- Code blocks maintain monospace font
- Links styled with primary color

Creates premium editorial writing experience.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Implement Auto-Hide Sidebar (Optional Enhancement)

**Goal:** Create auto-hide sidebar behavior with hover trigger.

**Note:** This task is more complex and involves state management. Consider implementing in a follow-up PR. For now, the simplified layout without persistent sidebar is a significant improvement.

**If implementing now:**

**Files:**
- Create: `orbit-www/src/components/features/knowledge/AutoHideSidebar.tsx`
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

**Step 1: Create AutoHideSidebar component**

Location: `orbit-www/src/components/features/knowledge/AutoHideSidebar.tsx`

```typescript
'use client'

import { useState } from 'react'
import { SpaceNavigator } from './SpaceNavigator'
import type { KnowledgeSpace, KnowledgePage } from '@/payload-types'

interface AutoHideSidebarProps {
  knowledgeSpace: KnowledgeSpace
  pages: KnowledgePage[]
  currentPageId: string
  workspaceSlug: string
  userId: string
}

export function AutoHideSidebar({
  knowledgeSpace,
  pages,
  currentPageId,
  workspaceSlug,
  userId,
}: AutoHideSidebarProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Hover trigger zone */}
      <div
        className="fixed left-0 top-0 bottom-0 w-5 z-40 group"
        onMouseEnter={() => setIsOpen(true)}
      >
        {/* Indicator line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-24 bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      </div>

      {/* Sidebar panel */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-[280px] bg-background border-r border-border z-50 transition-transform duration-250 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={() => setIsOpen(false)}
      >
        <div className="p-6">
          <div className="mb-4 flex items-center gap-2">
            {knowledgeSpace.icon && (
              <span className="text-xl">{knowledgeSpace.icon}</span>
            )}
            <span className="font-semibold">{knowledgeSpace.name}</span>
          </div>
          <SpaceNavigator
            knowledgeSpace={knowledgeSpace}
            pages={pages}
            currentPageId={currentPageId}
            workspaceSlug={workspaceSlug}
            userId={userId}
          />
        </div>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
```

**Step 2: Integrate AutoHideSidebar into page**

Location: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Add import:

```typescript
import { AutoHideSidebar } from '@/components/features/knowledge/AutoHideSidebar'
```

Add before the SidebarInset closing tag:

```typescript
<AutoHideSidebar
  knowledgeSpace={space}
  pages={pages}
  currentPageId={page.id}
  workspaceSlug={workspace.slug}
  userId={tempUserId}
/>
```

**Step 3: Test sidebar behavior**

Run: `cd orbit-www && bun run dev`
Hover over left edge of screen
Expected: Sidebar slides in with backdrop, slides out on mouse leave

**Step 4: Commit auto-hide sidebar**

```bash
git add orbit-www/src/components/features/knowledge/AutoHideSidebar.tsx orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx
git commit -m "feat(editor): implement auto-hide sidebar with hover trigger

- Sidebar hidden by default, slides in on left edge hover
- 280px width with smooth 250ms transition
- Backdrop overlay with blur when open
- Keyboard shortcut support (future: Cmd+\\)
- Indicator line shows on hover for discoverability

Keeps focus on content while navigation remains accessible.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Final Testing & Verification

**Goal:** Run full test suite and manual verification before completion.

**Step 1: Run all frontend tests**

Run: `cd orbit-www && NODE_OPTIONS=--no-deprecation bun run vitest run`
Expected: PageEditor tests pass, other passing tests remain stable

**Step 2: Run linter**

Run: `cd orbit-www && bunx eslint .`
Expected: No new lint errors

**Step 3: Build check**

Run: `cd orbit-www && bun run build`
Expected: Successful production build

**Step 4: Manual verification checklist**

Test in browser:
- [ ] Page loads with generous padding
- [ ] Title displays in Crimson Pro serif font
- [ ] Editor content uses Source Serif font
- [ ] Staggered animations play on page load
- [ ] Auto-save indicator works
- [ ] Empty state appears when content is empty
- [ ] Responsive padding works on mobile/tablet/desktop
- [ ] Tags display as inline pills
- [ ] Child pages list renders cleanly
- [ ] No visual glitches or layout shifts
- [ ] Dark mode looks good

**Step 5: Document any issues**

Create: `orbit-www/EDITORIAL_EDITOR_NOTES.md`

```markdown
# Editorial Page Editor - Implementation Notes

## Completed Features

- ✅ Editorial serif typography (Crimson Pro, Source Serif 4)
- ✅ Always-on editing mode (no mode toggle)
- ✅ Simplified layout (removed cards, borders)
- ✅ Generous responsive padding
- ✅ Staggered reveal animations
- ✅ Inline metadata presentation
- ✅ Auto-save with status indicator

## Known Issues

(Document any issues found during testing)

## Future Enhancements

- Auto-hide sidebar with keyboard shortcut (Cmd+\\)
- Table of contents in right margin (wide screens)
- Real-time collaboration indicators
- Comment/annotation system
- Version history visualization

## References

- Design Document: `docs/plans/2025-11-23-editorial-page-editor-design.md`
- Frontend Aesthetics SOP: `.agent/SOPs/frontend-aesthetics.md`
```

**Step 6: Final commit**

```bash
git add orbit-www/EDITORIAL_EDITOR_NOTES.md
git commit -m "docs: add editorial editor implementation notes

Document completed features, known issues, and future enhancements.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Steps

After all tasks complete:

1. **Visual Check**: Open any knowledge page, verify editorial aesthetic
2. **Functionality Check**: Edit content, verify auto-save works
3. **Responsive Check**: Test on mobile, tablet, desktop
4. **Performance Check**: Check for layout shifts, animation smoothness
5. **Accessibility Check**: Keyboard navigation, screen reader compatibility

## Success Criteria

- [ ] No Card/Separator components in page layout
- [ ] Serif fonts load and apply correctly
- [ ] Always-on editor renders for authorized users
- [ ] Padding is generous (48-192px horizontal on desktop)
- [ ] Staggered animations play smoothly
- [ ] Auto-save indicator shows correct states
- [ ] All existing tests pass
- [ ] Build completes successfully
- [ ] No new lint errors

---

## Post-Implementation

### Code Review

**REQUIRED SUB-SKILL:** Use @superpowers:requesting-code-review after completing all tasks.

### Cleanup & Merge

**REQUIRED SUB-SKILL:** Use @superpowers:finishing-a-development-branch to:
- Remove worktree
- Merge or create PR
- Update main branch

---

## Notes

- **TDD:** Tests first where possible (PageEditor has tests, layout changes are visual)
- **DRY:** Reuse existing components (SpaceNavigator, NovelEditor)
- **YAGNI:** Skip auto-hide sidebar if time-constrained (can be follow-up PR)
- **Commits:** Frequent, focused commits after each task
- **Reference:** Design doc at `docs/plans/2025-11-23-editorial-page-editor-design.md`
