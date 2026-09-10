import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Loader2, Play, Plus, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  getManageableTemplateWorkspaces,
  listAuthorableTemplates,
  listRunnableTemplates,
  type TemplateListItem,
} from './editor-actions'

/**
 * Template catalog + authoring list (Template Authoring Phase 2, Task 8).
 *
 * A Server Component: auth, RBAC and data all resolve server-side, and every
 * list this renders is scoped by the server action itself (never by a
 * client-supplied workspace id). Tab and filter state lives in the URL rather
 * than a client component, so the page ships no JavaScript of its own.
 *
 * - **Run** — published templates the caller may run (any active member).
 * - **Drafts** — non-published definitions in workspaces the caller may
 *   manage (owner/admin). Hidden entirely for callers who manage none, which
 *   is also why the "New template" CTA is gated on the same list.
 */

type Tab = 'run' | 'drafts'
type DraftFilter = 'mine' | 'workspace'

interface PageProps {
  searchParams: Promise<{ tab?: string; filter?: string }>
}

function statusVariant(status: TemplateListItem['status']) {
  if (status === 'published') return 'default' as const
  if (status === 'deprecated') return 'destructive' as const
  return 'secondary' as const
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof FileText; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Icon className="mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function TemplateCard({ item, href, cta }: { item: TemplateListItem; href: string; cta: string }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{item.title || item.name}</CardTitle>
          <Badge variant={statusVariant(item.status)} className="shrink-0 capitalize">
            {item.status}
          </Badge>
        </div>
        <CardDescription className="line-clamp-2">
          {item.description || 'No description.'}
        </CardDescription>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>{item.workspaceName}</span>
          {item.targetKind ? <span>&middot; {item.targetKind}</span> : null}
          {item.owner ? <span>&middot; {item.owner}</span> : null}
        </div>
      </CardHeader>
      <CardFooter>
        <Button asChild size="sm" variant={item.status === 'published' ? 'default' : 'outline'}>
          <Link href={href}>{cta}</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

async function RunTab() {
  const items = await listRunnableTemplates()
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Play}
        title="No published templates yet"
        body="Published templates appear here for anyone in the workspace to run. An owner or admin can author and publish one."
      />
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <TemplateCard
          key={item.id}
          item={item}
          href={`/self-service/templates/${encodeURIComponent(item.slug)}/run`}
          cta="Run"
        />
      ))}
    </div>
  )
}

async function DraftsTab({ filter }: { filter: DraftFilter }) {
  const all = await listAuthorableTemplates()
  const items = filter === 'mine' ? all.filter((t) => t.mine) : all

  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={filter === 'mine' ? 'You have no drafts' : 'No drafts in your workspaces'}
        body="Drafts are only visible to workspace owners and admins. Create one to start authoring a paved path."
      />
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <TemplateCard
          key={item.id}
          item={item}
          href={`/self-service/templates/${item.id}/edit`}
          cta="Edit"
        />
      ))}
    </div>
  )
}

/** A link styled as a tab trigger — keeps this page a pure Server Component. */
function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

async function NewTemplateButton() {
  const workspaces = await getManageableTemplateWorkspaces()
  if (workspaces.length === 0) return null
  return (
    <Button asChild size="sm">
      <Link href="/self-service/templates/new">
        <Plus className="h-4 w-4" />
        New template
      </Link>
    </Button>
  )
}

export default async function TemplatesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const tab: Tab = params.tab === 'drafts' ? 'drafts' : 'run'
  const filter: DraftFilter = params.filter === 'workspace' ? 'workspace' : 'mine'

  // Gate the Drafts tab on the same RBAC as the CTA — a member who manages no
  // workspace never sees a drafts affordance, and the server actions behind it
  // return nothing for them regardless.
  const manageable = await getManageableTemplateWorkspaces()
  const canAuthor = manageable.length > 0
  const activeTab: Tab = tab === 'drafts' && !canAuthor ? 'run' : tab

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Self-Service
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">Templates</h1>
                <p className="mt-2 text-muted-foreground">
                  Paved paths developers can run, authored and versioned in Orbit.
                </p>
              </div>
              <Suspense fallback={null}>
                <NewTemplateButton />
              </Suspense>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Template views"
              className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
            >
              <TabLink href="/self-service/templates?tab=run" active={activeTab === 'run'}>
                Run
              </TabLink>
              {canAuthor ? (
                <TabLink
                  href={`/self-service/templates?tab=drafts&filter=${filter}`}
                  active={activeTab === 'drafts'}
                >
                  Drafts
                </TabLink>
              ) : null}
            </nav>

            {activeTab === 'drafts' ? (
              <nav
                aria-label="Draft owner filter"
                className="inline-flex items-center gap-1 rounded-lg bg-muted p-1"
              >
                <TabLink href="/self-service/templates?tab=drafts&filter=mine" active={filter === 'mine'}>
                  Mine
                </TabLink>
                <TabLink
                  href="/self-service/templates?tab=drafts&filter=workspace"
                  active={filter === 'workspace'}
                >
                  Workspace
                </TabLink>
              </nav>
            ) : null}
          </div>

          <Suspense
            key={`${activeTab}:${filter}`}
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {activeTab === 'drafts' ? <DraftsTab filter={filter} /> : <RunTab />}
          </Suspense>

          {!canAuthor && activeTab === 'run' ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5" />
              Authoring templates requires being an owner or admin of a workspace.
            </p>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
