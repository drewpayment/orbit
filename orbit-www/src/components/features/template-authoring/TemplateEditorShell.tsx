/**
 * Template editor shell — Template Authoring Phase 2, Task 14.
 *
 * The one client component that owns the builder reducer. Everything else on
 * this page is a presentational panel fed from it: metadata, the
 * Parameters/Steps/Output tabs, the collapsible YAML view, and a persistent
 * bottom bar (Save draft / Validate / Dry run / Publish / Deprecate /
 * Export).
 *
 * Design notes worth keeping in mind when changing this:
 *
 * - **One source of truth.** Builder state is the definition JSON. The YAML
 *   view is a derived serialization that only writes back through
 *   `REPLACE_ALL`, and only when it parses — invalid YAML never clobbers
 *   state (plan architecture decision #3).
 * - **The publish button is a hint, not a gate.** It disables until the
 *   saved version carries both a validation stamp and a recorded dry run,
 *   with a tooltip saying which is missing. `publishTemplateDefinition` and
 *   `publishVersion` enforce the same rules server-side and their rejection
 *   is surfaced verbatim — this UI never assumes the disabled state held.
 * - **Every server action arrives as a prop.** The page (a Server Component)
 *   binds the real ones; tests pass fakes. That also keeps the panels free of
 *   any `'use server'` import.
 */
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, PanelRightClose, PanelRightOpen, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ActionDescriptor, ValidationResult } from '@/lib/scaffolder/validate'
import type { ActionRun } from '@/payload-types'
import {
  createInitialBuilderState,
  serializeDefinition,
  templateBuilderReducer,
} from './builder-state'
import { ParametersBuilder } from './ParametersBuilder'
import { ParametersPreview } from './ParametersPreview'
import { StepsBuilder } from './StepsBuilder'
import { OutputBuilder } from './OutputBuilder'
import { YamlView } from './YamlView'
import { ValidationPanel } from './ValidationPanel'
import { DryRunPanel } from './DryRunPanel'
import { FixturesPanel, type FixtureRow } from './FixturesPanel'
import { VersionsPanel, type VersionRow } from './VersionsPanel'
import type { EditorTab, JumpTarget } from './validation-jump'

/** The server actions the shell needs, injected so this renders under test. */
export interface TemplateEditorActions {
  saveTemplateDefinitionDraft: (
    id: string,
    definitionJson: unknown,
    changeNote?: string,
  ) => Promise<{ versionId: string }>
  validateTemplateDefinition: (definitionJson: unknown) => Promise<ValidationResult>
  markVersionValidated: (versionId: string) => Promise<ValidationResult>
  startDryRun: (input: {
    templateVersionId: string
    parameters: Record<string, unknown>
    fixtureId?: string
  }) => Promise<{ runId: string }>
  getRun: (runId: string) => Promise<ActionRun | null>
  recordSuccessfulDryRun: (versionId: string, runId: string) => Promise<{ recorded: boolean }>
  publishTemplateDefinition: (id: string) => Promise<{ id: string }>
  deprecateTemplateDefinition: (id: string) => Promise<{ id: string }>
  saveFixture: (
    definitionId: string,
    fixture: { id?: string; name: string; values?: unknown },
  ) => Promise<{ id: string }>
  deleteFixture: (definitionId: string, fixtureId: string) => Promise<void>
}

export interface TemplateEditorShellProps {
  definitionId: string
  status: 'draft' | 'published' | 'deprecated'
  /** The definition's own workspace — threaded into every Orbit picker rendered by this shell (parameters preview, steps, dry-run panel) so they can scope their lookups. */
  workspaceId: string
  initialDefinition: TemplateDefinition
  currentVersionId: string | null
  /** Publish-gate facts for the current version, as persisted. */
  currentVersionValidated: boolean
  currentVersionHasDryRun: boolean
  registry: ActionDescriptor[]
  fixtures: FixtureRow[]
  versions: VersionRow[]
  actions: TemplateEditorActions
}

type BuilderTab = 'parameters' | 'steps' | 'output'

/**
 * `metadata.name` must match `/^[a-z][a-z0-9-]*$/` (lib/scaffolder/schema.ts).
 * Normalizing on blur keeps a stray capital or space from failing the save
 * with a raw Zod message and from putting the YAML panel into a parse error
 * on every keystroke.
 */
function slugifyIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Anchor id on the metadata card, so a metadata validation error can jump to it. */
const METADATA_PANEL_ID = 'template-metadata-panel'

function isBuilderTab(tab: EditorTab): tab is BuilderTab {
  return tab === 'parameters' || tab === 'steps' || tab === 'output'
}

export function TemplateEditorShell({
  definitionId,
  status,
  workspaceId,
  initialDefinition,
  currentVersionId,
  currentVersionValidated,
  currentVersionHasDryRun,
  registry,
  fixtures,
  versions,
  actions,
}: TemplateEditorShellProps) {
  const router = useRouter()

  const [definition, dispatch] = React.useReducer(
    templateBuilderReducer,
    initialDefinition,
    createInitialBuilderState,
  )

  // The serialization last persisted. Comparing against it is how "dirty" is
  // derived, so an edit-then-undo correctly reads as clean.
  const [savedSnapshot, setSavedSnapshot] = React.useState(() =>
    serializeDefinition(createInitialBuilderState(initialDefinition)),
  )
  const [versionId, setVersionId] = React.useState(currentVersionId)
  const [gateValidated, setGateValidated] = React.useState(currentVersionValidated)
  const [gateDryRun, setGateDryRun] = React.useState(currentVersionHasDryRun)

  const [tab, setTab] = React.useState<BuilderTab>('parameters')
  const [yamlOpen, setYamlOpen] = React.useState(false)
  const [validateToken, setValidateToken] = React.useState(0)
  const [dryRunValues, setDryRunValues] = React.useState<Record<string, unknown>>({})
  const [changeNote, setChangeNote] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [banner, setBanner] = React.useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const currentSnapshot = React.useMemo(() => serializeDefinition(definition), [definition])
  const dirty = currentSnapshot !== savedSnapshot

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setBanner(null)
    try {
      await fn()
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function onSaveDraft() {
    await withBusy('save', async () => {
      const { versionId: next } = await actions.saveTemplateDefinitionDraft(
        definitionId,
        definition,
        changeNote.trim() || undefined,
      )
      setVersionId(next)
      setSavedSnapshot(currentSnapshot)
      setChangeNote('')
      // A new version starts with neither gate fact.
      setGateValidated(false)
      setGateDryRun(false)
      setBanner({ kind: 'ok', text: 'Draft saved.' })
      router.refresh()
    })
  }

  /**
   * Validating a clean buffer also stamps the saved version, satisfying half
   * the publish gate. A dirty buffer is validated in-memory only — there is
   * no persisted version matching it to stamp, and stamping the older one
   * would be a lie.
   */
  const validate = React.useCallback(
    async (definitionJson: unknown): Promise<ValidationResult> => {
      if (!dirty && versionId) {
        const result = await actions.markVersionValidated(versionId)
        setGateValidated(result.ok)
        return result
      }
      return actions.validateTemplateDefinition(definitionJson)
    },
    [actions, dirty, versionId],
  )

  async function onPublish() {
    await withBusy('publish', async () => {
      await actions.publishTemplateDefinition(definitionId)
      setBanner({ kind: 'ok', text: 'Template published.' })
      router.refresh()
    })
  }

  async function onDeprecate() {
    await withBusy('deprecate', async () => {
      await actions.deprecateTemplateDefinition(definitionId)
      setBanner({ kind: 'ok', text: 'Template deprecated.' })
      router.refresh()
    })
  }

  /**
   * Exports exactly what is on screen, serialized locally, so the file can
   * never disagree with the editor. (`exportTemplateDefinitionYaml` returns
   * the last saved version instead, which would silently omit unsaved edits.)
   */
  function onExport() {
    const blob = new Blob([currentSnapshot], { type: 'application/yaml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${slugifyIdentifier(definition.metadata.name) || 'orbit-template'}.yaml`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function onJumpTo(target: JumpTarget) {
    // Best-effort, per the plan: switch to the owning tab, or scroll the
    // metadata card into view. The builders do not expose per-field focus, so
    // a deeper jump than that is a follow-up.
    if (isBuilderTab(target.tab)) {
      setTab(target.tab)
      return
    }
    document.getElementById(METADATA_PANEL_ID)?.scrollIntoView({ block: 'center' })
  }

  const publishBlockers: string[] = []
  if (status === 'published') publishBlockers.push('This template is already published.')
  if (dirty) publishBlockers.push('Save your changes first.')
  if (!versionId) publishBlockers.push('Save a draft first.')
  if (!gateValidated) publishBlockers.push('Validation has not passed for the saved version.')
  if (!gateDryRun) publishBlockers.push('No successful dry run recorded for the saved version.')
  const publishDisabled = publishBlockers.length > 0 || busy !== null

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {banner ? (
          <Alert variant={banner.kind === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{banner.text}</AlertDescription>
          </Alert>
        ) : null}

        {/* Metadata */}
        <Card id={METADATA_PANEL_ID}>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="meta-name">Identifier</Label>
              <Input
                id="meta-name"
                value={definition.metadata.name}
                onChange={(e) => dispatch({ type: 'SET_METADATA', metadata: { name: e.target.value } })}
                onBlur={(e) => {
                  const normalized = slugifyIdentifier(e.target.value)
                  if (normalized !== e.target.value) {
                    dispatch({ type: 'SET_METADATA', metadata: { name: normalized } })
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits and dashes.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-title">Title</Label>
              <Input
                id="meta-title"
                value={definition.metadata.title}
                onChange={(e) => dispatch({ type: 'SET_METADATA', metadata: { title: e.target.value } })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="meta-description">Description</Label>
              <Textarea
                id="meta-description"
                rows={2}
                value={definition.metadata.description ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'SET_METADATA', metadata: { description: e.target.value } })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-owner">Owner</Label>
              <Input
                id="meta-owner"
                value={definition.metadata.owner}
                onChange={(e) => dispatch({ type: 'SET_METADATA', metadata: { owner: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-target-kind">Target kind</Label>
              <Input
                id="meta-target-kind"
                value={definition.metadata.targetKind ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'SET_METADATA', metadata: { targetKind: e.target.value } })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Builder + YAML split */}
        <div
          className={cn(
            'grid gap-4',
            yamlOpen ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]' : 'grid-cols-1',
          )}
        >
          <div className="min-w-0 space-y-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as BuilderTab)}>
              <TabsList>
                <TabsTrigger value="parameters">Parameters</TabsTrigger>
                <TabsTrigger value="steps">Steps</TabsTrigger>
                <TabsTrigger value="output">Output</TabsTrigger>
              </TabsList>

              <TabsContent value="parameters" className="mt-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <ParametersBuilder pages={definition.spec.parameters} dispatch={dispatch} />
                  <div className="rounded-md border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Preview</h3>
                    <ParametersPreview pages={definition.spec.parameters} workspaceId={workspaceId} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="steps" className="mt-4">
                {registry.length === 0 ? (
                  <Alert className="mb-3">
                    <AlertDescription>
                      The action registry is empty. The scaffolder worker is unreachable, so no
                      steps can be added until it is running.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <StepsBuilder
                  definition={definition}
                  dispatch={dispatch}
                  registry={registry}
                  workspaceId={workspaceId}
                />
              </TabsContent>

              <TabsContent value="output" className="mt-4">
                <OutputBuilder definition={definition} dispatch={dispatch} registry={registry} />
              </TabsContent>
            </Tabs>

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <ValidationPanel
                      definition={definition}
                      validate={validate}
                      onJumpTo={onJumpTo}
                      runToken={validateToken}
                      showTrigger={false}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <FixturesPanel
                      definitionId={definitionId}
                      fixtures={fixtures}
                      currentValues={dryRunValues}
                      onApply={setDryRunValues}
                      saveFixture={actions.saveFixture}
                      deleteFixture={actions.deleteFixture}
                      onChanged={() => router.refresh()}
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <DryRunPanel
                      versionId={versionId}
                      pages={definition.spec.parameters}
                      fixtures={fixtures}
                      dirty={dirty}
                      values={dryRunValues}
                      onValuesChange={setDryRunValues}
                      startDryRun={actions.startDryRun}
                      getRun={actions.getRun}
                      recordSuccessfulDryRun={actions.recordSuccessfulDryRun}
                      workspaceId={workspaceId}
                      onGateSatisfied={() => {
                        setGateDryRun(true)
                        router.refresh()
                      }}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <VersionsPanel versions={versions} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {yamlOpen ? (
            <div className="min-w-0">
              <Card className="lg:sticky lg:top-4">
                {/*
                  An explicit height matters: YamlView's Monaco instance sizes
                  itself to its container, and inside an auto-height card it
                  measures ~0 on mount and never relayouts, collapsing the
                  editor to a sliver.
                */}
                <CardContent className="flex h-[70vh] flex-col pt-6">
                  <h3 className="mb-2 text-sm font-semibold">YAML</h3>
                  <YamlView
                    definition={definition}
                    /*
                      Normalized through createInitialBuilderState so a YAML
                      round trip lands in the same key order the reducer's own
                      state uses. Dispatching the raw parse result instead
                      reorders `metadata` (the Zod schema and the reducer's
                      EMPTY-merge disagree on where `description` sits), which
                      made a no-op YAML edit flip `dirty` forever.
                    */
                    onReplaceAll={(next) =>
                      dispatch({ type: 'REPLACE_ALL', definition: createInitialBuilderState(next) })
                    }
                  />
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        {/*
          Bottom bar. Sticky inside the content column rather than
          `fixed inset-x-0`, which spans the whole window and covers the app
          sidebar. The negative margin lets it bleed to the edges of the
          page's padding while staying inside the content area.
        */}
        <div className="sticky bottom-0 z-20 -mx-8 border-t bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={dirty ? 'secondary' : 'outline'}>
              {dirty ? 'Unsaved changes' : 'Saved'}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {status}
            </Badge>

            <Input
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Change note (optional)"
              aria-label="Change note"
              className="h-9 w-56"
            />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setYamlOpen((v) => !v)}>
                {yamlOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
                YAML
              </Button>
              <Button size="sm" variant="outline" onClick={onExport}>
                <Download className="h-4 w-4" />
                Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setValidateToken((n) => n + 1)}
                disabled={busy !== null}
              >
                Validate
              </Button>
              <Button size="sm" onClick={() => void onSaveDraft()} disabled={busy !== null || !dirty}>
                {busy === 'save' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save draft
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  {/* A span wrapper keeps the tooltip reachable while the button is disabled. */}
                  <span>
                    <Button
                      size="sm"
                      onClick={() => void onPublish()}
                      disabled={publishDisabled}
                      aria-describedby={publishBlockers.length ? 'publish-blockers' : undefined}
                    >
                      {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Publish
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent id="publish-blockers">
                  {publishBlockers.length === 0 ? (
                    <span>Publish this version.</span>
                  ) : (
                    <ul className="list-disc pl-4">
                      {publishBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </TooltipContent>
              </Tooltip>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={busy !== null}>
                    Deprecate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Deprecate this template?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It will stop appearing in the catalog for people to run. Existing runs are
                      unaffected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void onDeprecate()}>
                      Deprecate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
