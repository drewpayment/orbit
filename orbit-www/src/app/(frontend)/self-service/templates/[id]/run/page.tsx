import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canRunTemplateDefinition } from '@/lib/templates/authz'
import { getTemplateDefinitionByIdOrSlug } from '../../run-actions'
import { planRun, startRun } from '../../authoring-actions'
import { getRun } from '../../authoring-actions'
import { TemplateDefinitionSchema } from '@/lib/scaffolder/schema'
import { parameterPageToSchemaFormPage } from '@/components/features/template-authoring/schema-ui-split'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { RunWizard } from '@/components/features/template-authoring/RunWizard'
import type { TemplateDefinitionVersion } from '@/payload-types'

interface PageProps {
  // Named `id` (not `slug`) to match `/self-service/templates/[id]/edit`
  // (the authoring-shell route) — Next.js requires one consistent dynamic
  // segment name per path across all routes sharing that path. The value
  // can be either a definition's Payload id OR its slug;
  // `getTemplateDefinitionByIdOrSlug` resolves both.
  params: Promise<{ id: string }>
}

/**
 * Consumer run wizard entry point (Phase 2 plan Task 16). Resolves the
 * PUBLISHED template by id or slug, re-checks `canRunTemplateDefinition`
 * explicitly (defense in depth — `getTemplateDefinitionByIdOrSlug` already
 * gates this, but a route whose entire purpose is "run this template"
 * checks the run permission directly rather than solely trusting a shared
 * loader's internal gate), and 404s on any denial or non-published status
 * rather than redirecting (never leaks whether an unpublished/nonexistent
 * id/slug exists).
 */
export default async function RunTemplatePage({ params }: PageProps) {
  const { id } = await params

  const definition = await getTemplateDefinitionByIdOrSlug(id)
  if (!definition || definition.status !== 'published') notFound()

  const payload = await getPayload({ config })
  const user = await getCurrentUser()
  const payloadUser = await getPayloadUserFromSession()
  const workspaceId = typeof definition.workspace === 'string' ? definition.workspace : definition.workspace?.id
  const canRun = await canRunTemplateDefinition(payload, user?.id, workspaceId, isPlatformAdmin(payloadUser))
  if (!canRun) notFound()

  const versionId = relId(definition.currentVersion)
  if (!versionId) notFound()

  let version: TemplateDefinitionVersion
  try {
    version = await payload.findByID({
      collection: 'template-definition-versions',
      id: versionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    notFound()
  }

  const parsed = TemplateDefinitionSchema.safeParse(version.definitionJson)
  if (!parsed.success) notFound()

  const pages = parsed.data.spec.parameters.map((p) => parameterPageToSchemaFormPage(p, workspaceId))

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service/templates"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Templates
            </Link>
            <h1 className="text-3xl font-bold">{parsed.data.metadata.title}</h1>
            {parsed.data.metadata.description && (
              <p className="mt-2 text-muted-foreground">{parsed.data.metadata.description}</p>
            )}
          </div>

          <RunWizard
            templateId={id}
            templateVersionId={version.id}
            pages={pages}
            planRun={planRun}
            startRun={startRun}
            getRun={getRun}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}
