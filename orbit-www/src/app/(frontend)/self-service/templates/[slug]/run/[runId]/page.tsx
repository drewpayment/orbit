import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTemplateDefinitionBySlug } from '../../../run-actions'
import { getRun } from '../../../authoring-actions'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateRunDetail } from '@/components/features/template-authoring/TemplateRunDetail'

interface PageProps {
  params: Promise<{ slug: string; runId: string }>
}

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/**
 * Consumer run detail entry point (Phase 2 plan Task 17). `getRun` already
 * scopes the run to the caller's workspace access (RBAC) — this page adds
 * the one check `getRun` can't make on its own: that the run's
 * `templateVersion` actually belongs to THIS slug's definition, so a
 * same-workspace member can't view a run they have access to under a
 * mismatched (but still-valid-looking) `[slug]/run/[runId]` URL.
 */
export default async function RunDetailPage({ params }: PageProps) {
  const { slug, runId } = await params

  const [definition, run] = await Promise.all([getTemplateDefinitionBySlug(slug), getRun(runId)])
  if (!definition || !run) notFound()

  const runVersionId = relId(run.templateVersion)
  const runDefinitionId =
    run.templateVersion && typeof run.templateVersion === 'object'
      ? relId(run.templateVersion.definition)
      : null
  if (!runVersionId || runDefinitionId !== definition.id) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href={`/self-service/templates/${slug}/run`}
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {definition.title ?? definition.name}
            </Link>
            <h1 className="text-3xl font-bold">Run detail</h1>
          </div>

          <TemplateRunDetail initialRun={run} getRun={getRun} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
