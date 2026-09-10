import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageTemplateDefinitions } from '@/lib/templates/authz'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateEditorShell } from '@/components/features/template-authoring/TemplateEditorShell'
import { createInitialBuilderState } from '@/components/features/template-authoring/builder-state'
import { TemplateDefinitionSchema, type TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import type { TemplateDefinition as TemplateDefinitionDoc, TemplateDefinitionVersion } from '@/payload-types'
import {
  listActionRegistry,
  saveTemplateDefinitionDraft,
  validateTemplateDefinition,
  startDryRun,
  getRun,
  publishTemplateDefinition,
  deprecateTemplateDefinition,
  saveFixture,
  deleteFixture,
} from '../../authoring-actions'
import {
  listTemplateDefinitionVersions,
  markVersionValidated,
  recordSuccessfulDryRun,
} from '../../editor-actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Template editor (Template Authoring Phase 2, Task 14).
 *
 * A Server Component: it resolves the session, checks
 * `canManageTemplateDefinitions` against the definition's OWN workspace, and
 * calls `notFound()` — never a redirect — when the definition is missing or
 * the caller may not manage it, so a draft's existence never leaks.
 *
 * It loads everything the client shell needs (definition, current version,
 * action registry, fixtures, version history) and binds the server actions
 * the shell calls, keeping every `'use server'` import on this side of the
 * boundary.
 */
export default async function EditTemplatePage({ params }: PageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  const isAdmin = isPlatformAdmin(await getPayloadUserFromSession())

  let definition: TemplateDefinitionDoc
  try {
    definition = await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    notFound()
  }

  const workspaceId =
    typeof definition.workspace === 'string' ? definition.workspace : definition.workspace?.id
  if (!(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    notFound()
  }

  const currentVersionId =
    typeof definition.currentVersion === 'string'
      ? definition.currentVersion
      : (definition.currentVersion?.id ?? null)

  let version: TemplateDefinitionVersion | null = null
  if (currentVersionId) {
    try {
      version = await payload.findByID({
        collection: 'template-definition-versions',
        id: currentVersionId,
        depth: 0,
        overrideAccess: true,
      })
    } catch {
      version = null
    }
  }

  // A stored definition that no longer parses (hand-edited, or written by an
  // older schema) must still open in the editor — fall back to a blank
  // document seeded with the row's metadata rather than 500ing the author out
  // of the only screen where they could fix it.
  const parsed = TemplateDefinitionSchema.safeParse(version?.definitionJson)
  const initialDefinition: TemplateDefinition = parsed.success
    ? parsed.data
    : createInitialBuilderState({
        metadata: {
          name: definition.slug,
          title: definition.title || definition.name,
          description: definition.description ?? undefined,
          owner: definition.owner || 'unassigned',
          targetKind: definition.targetKind ?? undefined,
        },
      })

  // The registry comes from the Go worker over gRPC and may be unreachable
  // locally; an empty list degrades the Steps tab with an explanation rather
  // than failing the page.
  let registry: ActionDescriptor[] = []
  try {
    registry = await listActionRegistry()
  } catch {
    registry = []
  }

  const versions = await listTemplateDefinitionVersions(id)

  const fixtures = (definition.fixtures ?? []).map((f) => ({
    id: f.id ?? null,
    name: f.name,
    values: f.values,
  }))

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
            <h1 className="text-3xl font-bold">{definition.title || definition.name}</h1>
            <p className="mt-2 text-muted-foreground">
              Author the form, the steps that run, and what the template hands back.
            </p>
          </div>

          {!parsed.success && version ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              The saved version could not be read as a v2 template. The editor has started from a
              blank document; saving will replace it.
            </p>
          ) : null}

          <TemplateEditorShell
            definitionId={definition.id}
            status={definition.status}
            initialDefinition={initialDefinition}
            currentVersionId={currentVersionId}
            currentVersionValidated={!!version?.validatedAt}
            currentVersionHasDryRun={!!version?.dryRunRunId}
            registry={registry}
            fixtures={fixtures}
            versions={versions}
            actions={{
              saveTemplateDefinitionDraft,
              validateTemplateDefinition,
              markVersionValidated,
              startDryRun,
              getRun,
              recordSuccessfulDryRun,
              publishTemplateDefinition,
              deprecateTemplateDefinition,
              saveFixture,
              deleteFixture,
            }}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
