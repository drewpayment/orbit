'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import * as yaml from 'yaml'
import Ajv from 'ajv'
import type { Where } from 'payload'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import {
  canManageTemplateDefinitions,
  canPublishTemplateDefinition,
  canRunTemplateDefinition,
  type TemplateVisibility,
} from '@/lib/templates/authz'
import { createDraftVersion, publishVersion, deprecateDefinition } from '@/lib/scaffolder/versions'
import { TemplateDefinitionSchema, type TemplateDefinition as DefinitionJson } from '@/lib/scaffolder/schema'
import { validateDefinition, type ActionDescriptor, type ValidationResult } from '@/lib/scaffolder/validate'
import { RegistryUnavailableError } from '@/lib/scaffolder/registry-errors'
import { listActions as listActionsRpc } from '@/lib/clients/template-client'
import { executeRun } from '@/lib/actions/run'
import { evaluateVisibleIf } from '@/lib/scaffolder/visible-if'
import { RegistryUnavailableError } from '@/lib/scaffolder/registry-errors'
import type {
  TemplateDefinition as TemplateDefinitionDoc,
  TemplateDefinitionVersion,
  ActionRun,
  Action,
} from '@/payload-types'

/**
 * RBAC-gated authoring + run server actions for the In-App Template
 * Authoring surfaces (`/self-service/templates/**`, phase-2 plan §0 + Task
 * 8). Mirrors `self-service/authoring-actions.ts`'s conventions exactly:
 * resolve the session user, gate through `lib/templates/authz.ts` BEFORE
 * every read/write, then use `overrideAccess: true` (the gate here IS the
 * source of truth — never trust the collection's own `access` rules alone,
 * and never trust the client to have already checked).
 *
 * ## The Action-row decision (see final report for the full writeup)
 * `action-runs.action` is a REQUIRED relationship, so a template run cannot
 * exist without a backing `actions` row. Rather than widen that collection's
 * schema, each `template-definitions` row lazily gets one hidden `actions`
 * row (`backend: { type: 'scaffolder', ref: definitionId }`,
 * `approvalPolicy: 'none'`) the first time it's run — {@link ensureRunnerAction}.
 * This is the least invasive option: it reuses `lib/actions/run.ts`'s
 * existing scaffolder dispatch branch (Task 8.2) and the existing
 * `approvalPolicy` gate unchanged, at the cost of one extra hidden `actions`
 * doc per template. The hidden action is never returned to callers and never
 * listed in the self-service Actions catalog (catalog list `where`s on
 * `enabled: true` — future work could additionally filter `backend.type !==
 * 'scaffolder'` there if the hidden rows should be invisible to that page).
 *
 * ## Secrets
 * `ui:secret`-flagged parameter values are still persisted verbatim in
 * `action-runs.inputs` — the Go ScaffolderWorkflow needs the real value to
 * act on it, and this phase has no secrets-vault/encryption-at-rest layer to
 * hand them off through instead. {@link getRun} redacts `ui:secret` fields
 * before returning a run to a caller, so they never reach a client bundle,
 * a log line, or a rendered page from this module. At-rest encryption is a
 * documented follow-up (see the final report's Risks section) — never a
 * silent gap.
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/** Extract a relationship id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Resolve + assert the session user; throws when unauthenticated. Returns the better-auth id used throughout this codebase's workspace-members checks. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Whether the current session belongs to a platform admin (super_admin/admin). */
async function currentUserIsPlatformAdmin(): Promise<boolean> {
  const user = await getPayloadUserFromSession()
  return isPlatformAdmin(user)
}

async function loadDefinitionOrThrow(
  payload: PayloadClient,
  id: string,
): Promise<TemplateDefinitionDoc> {
  try {
    return await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Template definition not found')
  }
}

// ---------------------------------------------------------------------------
// listTemplateDefinitions / getTemplateDefinition
// ---------------------------------------------------------------------------

export interface ListTemplateDefinitionsInput {
  workspaceId: string
  /** Only rows authored by the caller. */
  mine?: boolean
}

/** List template-definitions in a workspace. Manage-gated (the authoring list page). */
export async function listTemplateDefinitions(
  input: ListTemplateDefinitionsInput,
): Promise<TemplateDefinitionDoc[]> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  if (!(await canManageTemplateDefinitions(payload, uid, input.workspaceId, isAdmin))) {
    return []
  }

  const and: Where[] = [{ workspace: { equals: input.workspaceId } }]
  if (input.mine) and.push({ createdBy: { equals: uid } })

  const result = await payload.find({
    collection: 'template-definitions',
    where: { and },
    sort: '-updatedAt',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs
}

/**
 * Load a single template-definition with `currentVersion` populated. Gated:
 * `draft`/`deprecated` rows require `canManageTemplateDefinitions` on the
 * row's workspace; `published` rows require `canRunTemplateDefinition`
 * (design §3.2: drafts are author/workspace-admin-only, published templates
 * are any active member). Returns `null` on denial or not-found so callers
 * can 404 rather than leak existence.
 */
export async function getTemplateDefinition(id: string): Promise<TemplateDefinitionDoc | null> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  let definition: TemplateDefinitionDoc
  try {
    definition = await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    return null
  }

  const workspaceId = relId(definition.workspace)
  const allowed =
    definition.status === 'published'
      ? await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin)
      : await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin)
  if (!allowed) return null

  return definition
}

// ---------------------------------------------------------------------------
// createTemplateDefinition / saveTemplateDefinitionDraft
// ---------------------------------------------------------------------------

export interface CreateTemplateDefinitionInput {
  workspaceId: string
  name: string
  title?: string
  description?: string
  tags?: string[]
  owner?: string
  targetKind?: string
  visibility?: TemplateVisibility
  sourceMode?: 'orbit' | 'git'
}

const SLUGIFY = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Creates a draft template-definition + its version-1 snapshot. Manage-gated. */
export async function createTemplateDefinition(
  input: CreateTemplateDefinitionInput,
): Promise<{ id: string; versionId: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  if (!(await canManageTemplateDefinitions(payload, uid, input.workspaceId, isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  const name = input.name?.trim()
  if (!name) throw new Error('A template name is required.')
  const metaName = SLUGIFY(name)
  if (!metaName) throw new Error('A template name is required.')

  const created = await payload.create({
    collection: 'template-definitions',
    data: {
      name,
      slug: metaName,
      workspace: input.workspaceId,
      title: input.title?.trim() || undefined,
      description: input.description?.trim() || undefined,
      owner: input.owner?.trim() || undefined,
      targetKind: input.targetKind?.trim() || undefined,
      visibility: input.visibility ?? 'workspace',
      sourceMode: input.sourceMode ?? 'orbit',
      status: 'draft',
      createdBy: uid,
    },
    overrideAccess: true,
  })

  const starter: DefinitionJson = {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: {
      name: metaName,
      title: input.title?.trim() || name,
      description: input.description?.trim() || undefined,
      tags: input.tags,
      owner: input.owner?.trim() || 'unassigned',
      targetKind: input.targetKind?.trim() || undefined,
    },
    spec: { parameters: [], steps: [] },
  }

  const version = await createDraftVersion(payload, {
    definitionId: created.id,
    definitionJson: starter,
    userId: uid,
    changeNote: 'Initial draft',
  })

  revalidatePath('/self-service/templates')
  return { id: created.id, versionId: version.id }
}

/**
 * Saves a new draft version snapshot for a definition. Validates the shape
 * (not the cross-referential registry checks — see {@link validateTemplateDefinition}
 * for that) before persisting, so a malformed document never becomes a
 * version row. Manage-gated on the definition's OWN workspace (never trust a
 * workspace id embedded in the payload).
 */
export async function saveTemplateDefinitionDraft(
  id: string,
  definitionJson: unknown,
  changeNote?: string,
): Promise<{ versionId: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, id)
  const workspaceId = relId(definition.workspace)
  if (!(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  const parsed = TemplateDefinitionSchema.safeParse(definitionJson)
  if (!parsed.success) {
    throw new Error(`Invalid template definition: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }

  const version = await createDraftVersion(payload, {
    definitionId: id,
    definitionJson: parsed.data,
    userId: uid,
    changeNote,
  })

  revalidatePath(`/self-service/templates/${id}/edit`)
  return { versionId: version.id }
}

// ---------------------------------------------------------------------------
// validateTemplateDefinition / listActionRegistry
// ---------------------------------------------------------------------------

/**
 * Runs the static validator (`lib/scaffolder/validate.ts`) against a
 * candidate definition JSON, first checking the Zod shape. No workspace RBAC
 * gate — this is a pure validation helper, callable by any authenticated
 * session, and touches no workspace data.
 */
export async function validateTemplateDefinition(definitionJson: unknown): Promise<ValidationResult> {
  await requireUserId()

  const parsed = TemplateDefinitionSchema.safeParse(definitionJson)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }
  }

  let registry: ActionDescriptor[]
  try {
    registry = await listActionRegistry()
  } catch (err) {
    if (err instanceof RegistryUnavailableError) {
      // MINOR: a transient gRPC/worker outage should surface as a
      // validation finding the authoring UI can render inline (design §3.2
      // "validate" panel), not an unhandled server-action rejection that
      // crashes the page.
      return { ok: false, errors: [{ path: '', message: err.message }] }
    }
    throw err
  }
  return validateDefinition(parsed.data, registry)
}

let registryCache: { at: number; entries: ActionDescriptor[] } | null = null
const REGISTRY_CACHE_MS = 60_000

/**
 * The Go action registry (design §3.4), as JSON-Schema descriptors for the
 * TS validator and Phase 2's step builder. Cached in-process for 60s — this
 * is global, workspace-independent data (every workspace sees the same
 * registry), so a shared cache is safe and never needs workspace scoping.
 * Throws {@link RegistryUnavailableError} (never the raw gRPC error) when the
 * worker's ListActions RPC fails.
 */
export async function listActionRegistry(): Promise<ActionDescriptor[]> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.entries
  }

  let response: Awaited<ReturnType<typeof listActionsRpc>>
  try {
    response = await listActionsRpc()
  } catch (err) {
    throw new RegistryUnavailableError(err)
  }

  const entries: ActionDescriptor[] = response.actions.map((a) => ({
    id: a.name,
    family: a.family,
    name: a.name,
    inputSchema: safeJsonParse(a.inputSchemaJson),
    outputSchema: safeJsonParse(a.outputSchemaJson),
    supportsPlan: a.supportsPlan,
  }))
  registryCache = { at: Date.now(), entries }
  return entries
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Runner-Action provisioning + secret redaction
// ---------------------------------------------------------------------------

/**
 * Lazily provisions (or finds) the hidden `actions` row backing a
 * template-definition's runs. See the module docblock's "Action-row
 * decision".
 */
async function ensureRunnerAction(payload: PayloadClient, definition: TemplateDefinitionDoc): Promise<Action> {
  const existing = await payload.find({
    collection: 'actions',
    where: {
      and: [
        { 'backend.type': { equals: 'scaffolder' } },
        { 'backend.ref': { equals: definition.id } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0]

  return payload.create({
    collection: 'actions',
    data: {
      name: `Template: ${definition.name}`,
      description: 'Auto-provisioned runner for a v2 template-definition. Not user-editable.',
      workspace: relId(definition.workspace) ?? '',
      backend: { type: 'scaffolder', ref: definition.id },
      approvalPolicy: 'none',
      enabled: true,
    },
    overrideAccess: true,
  })
}

/** Collect the `parameters.<key>` names flagged `ui:secret: true` across every page of a definition. */
function collectSecretParamKeys(definitionJson: unknown): Set<string> {
  const secretKeys = new Set<string>()
  if (!definitionJson || typeof definitionJson !== 'object') return secretKeys
  const spec = (definitionJson as { spec?: { parameters?: unknown[] } }).spec
  const pages = Array.isArray(spec?.parameters) ? spec!.parameters : []
  for (const page of pages) {
    const properties = (page as { properties?: Record<string, unknown> })?.properties
    if (!properties || typeof properties !== 'object') continue
    for (const [key, prop] of Object.entries(properties)) {
      if (prop && typeof prop === 'object' && (prop as Record<string, unknown>)['ui:secret'] === true) {
        secretKeys.add(key)
      }
    }
  }
  return secretKeys
}

const SECRET_PLACEHOLDER = '••••••••'

/** Redact `ui:secret`-flagged top-level parameter keys from an inputs object for display/return to a caller. */
function redactSecrets(
  inputs: Record<string, unknown> | null | undefined,
  secretKeys: Set<string>,
): Record<string, unknown> {
  const out = { ...(inputs ?? {}) }
  for (const key of secretKeys) {
    if (key in out) out[key] = SECRET_PLACEHOLDER
  }
  return out
}

/**
 * MINOR: a secret input value can echo verbatim into a step's declared
 * `output` (e.g. an action that returns what it was given) or into the dry
 * run `plan`. Deep-walks arrays/objects (deterministic depth cap — this data
 * comes from the Go worker, never from a client) replacing any leaf STRING
 * value that exactly equals one of the known secret values. Exact-match
 * only, by design: a secret value embedded as a substring of a longer
 * string (e.g. "used token abc123 to fetch...") is not caught — full
 * substring scanning has enough false-positive risk (a leaked value being
 * some other legitimate string) to be a separate follow-up, not folded into
 * this pass silently.
 */
function redactSecretValuesDeep(value: unknown, secretValues: Set<string>, depth = 0): unknown {
  if (depth > 12) return value
  if (typeof value === 'string') return secretValues.has(value) ? SECRET_PLACEHOLDER : value
  if (Array.isArray(value)) return value.map((v) => redactSecretValuesDeep(v, secretValues, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecretValuesDeep(v, secretValues, depth + 1)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// startDryRun / planRun / startRun
// ---------------------------------------------------------------------------

export interface StartDryRunInput {
  templateVersionId: string
  parameters: Record<string, unknown>
  fixtureId?: string
}

async function loadVersionAndDefinition(
  payload: PayloadClient,
  templateVersionId: string,
): Promise<{ version: TemplateDefinitionVersion; definition: TemplateDefinitionDoc }> {
  let version: TemplateDefinitionVersion
  try {
    version = await payload.findByID({
      collection: 'template-definition-versions',
      id: templateVersionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Template version not found')
  }
  const definitionId = relId(version.definition)
  if (!definitionId) throw new Error('Template version has no parent definition')
  const definition = await loadDefinitionOrThrow(payload, definitionId)
  return { version, definition }
}

/**
 * MAJOR 3: merges every `spec.parameters` page of a version's definitionJson
 * into one JSON Schema (`additionalProperties: false` — an unknown extra key
 * is rejected, not silently dropped or passed through) and validates
 * `parameters` against it with ajv (`strict: false`, matching
 * `lib/scaffolder/validate.ts`'s convention). Throws with a readable,
 * field-prefixed message on the FIRST validation failure — startDryRun/
 * startRun call this before persisting anything, so a malformed submission
 * never becomes an action-run row.
 *
 * Follow-up from re-review: a property whose `ui:visibleIf` evaluates
 * `false` against the SUBMITTED `parameters` is dropped from the merged
 * `required` list before validating — PR #103's SchemaForm unregisters a
 * hidden field from client-side submission entirely, so the server-side
 * "required" check must not reject its absence, or every conditional field
 * becomes impossible to submit. Uses `lib/scaffolder/visible-if.ts`
 * (evaluator kept behaviourally aligned with the schema-form one — see that
 * module's docblock).
 */
function validateRunParameters(version: TemplateDefinitionVersion, parameters: Record<string, unknown>): void {
  const definitionJson = version.definitionJson as { spec?: { parameters?: unknown[] } } | null
  const pages = Array.isArray(definitionJson?.spec?.parameters) ? definitionJson!.spec!.parameters : []

  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const page of pages) {
    const p = page as { properties?: Record<string, unknown>; required?: string[] }
    if (p.properties && typeof p.properties === 'object') {
      Object.assign(properties, p.properties)
    }
    if (Array.isArray(p.required)) required.push(...p.required)
  }

  const visibleRequired = required.filter((key) => {
    const prop = properties[key] as Record<string, unknown> | undefined
    const visibleIf = prop?.['ui:visibleIf']
    if (typeof visibleIf !== 'string') return true // no condition — always required as declared
    return evaluateVisibleIf(visibleIf, parameters)
  })

  const schema = {
    type: 'object',
    properties,
    required: visibleRequired,
    additionalProperties: false,
  }

  const ajv = new Ajv({ allErrors: true, strict: false })
  const validateFn = ajv.compile(schema)
  if (!validateFn(parameters)) {
    const messages = (validateFn.errors ?? []).map((e) => {
      const path = e.instancePath ? e.instancePath.replace(/^\//, '') : (e.params as { additionalProperty?: string })?.additionalProperty ?? ''
      return `${path ? `${path}: ` : ''}${e.message}`
    })
    throw new Error(`Invalid parameters: ${messages.join('; ')}`)
  }
}

/**
 * Shared dry-run creation core for {@link startDryRun} and {@link planRun} —
 * everything AFTER authorization: resolve fixture/parameters, validate,
 * provision the runner action, create + dispatch the `dryRun: true` run,
 * and stamp `lastDryRunAt`. Callers must authorize BEFORE calling this.
 */
async function createAndDispatchDryRun(
  payload: PayloadClient,
  uid: string,
  version: TemplateDefinitionVersion,
  definition: TemplateDefinitionDoc,
  workspaceId: string | null,
  input: StartDryRunInput,
): Promise<{ runId: string }> {
  let parameters = input.parameters ?? {}
  if (input.fixtureId) {
    const fixture = (definition.fixtures ?? []).find((f) => f.id === input.fixtureId)
    if (!fixture) throw new Error('Fixture not found')
    parameters =
      fixture.values && typeof fixture.values === 'object' && !Array.isArray(fixture.values)
        ? (fixture.values as Record<string, unknown>)
        : {}
  }

  validateRunParameters(version, parameters)

  const action = await ensureRunnerAction(payload, definition)

  const run = await payload.create({
    collection: 'action-runs',
    data: {
      action: action.id,
      workspace: workspaceId ?? '',
      templateVersion: version.id,
      dryRun: true,
      inputs: parameters,
      status: 'pending',
      triggeredBy: uid,
      trigger: 'manual',
      logs: [{ ts: new Date().toISOString(), level: 'info', message: 'Dry run created.' }],
    },
    overrideAccess: true,
  })

  await executeRun(payload, run.id)

  await payload.update({
    collection: 'template-definitions',
    id: definition.id,
    data: { lastDryRunAt: new Date().toISOString() },
    overrideAccess: true,
  })

  revalidatePath(`/self-service/templates/${definition.id}/edit`)
  return { runId: run.id }
}

/**
 * Creates a `dryRun: true` action-run for a template version and dispatches
 * it. Manage-gated ALWAYS (dry runs are an authoring/preview tool over any
 * draft, published, or deprecated version) — {@link planRun} is the
 * consumer-facing sibling with a looser gate for published definitions.
 */
export async function startDryRun(input: StartDryRunInput): Promise<{ runId: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const { version, definition } = await loadVersionAndDefinition(payload, input.templateVersionId)
  const workspaceId = relId(definition.workspace)
  if (!(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    throw new Error('You do not have permission to dry-run templates in this workspace.')
  }

  return createAndDispatchDryRun(payload, uid, version, definition, workspaceId, input)
}

/**
 * The consumer run wizard's "Review" step (design §3.6/§4) — a dry run IS
 * the plan, so this shares {@link startDryRun}'s creation/dispatch core but
 * with a DIFFERENT, looser authorization: side-effect-free, so any active
 * member may plan-run a PUBLISHED definition (`canRunTemplateDefinition`),
 * without needing the manage/owner-admin gate `startDryRun` otherwise
 * requires. A draft/deprecated definition still falls back to the manage
 * gate — a consumer has no business previewing an unpublished template.
 */
export async function planRun(input: StartDryRunInput): Promise<{ runId: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const { version, definition } = await loadVersionAndDefinition(payload, input.templateVersionId)
  const workspaceId = relId(definition.workspace)

  const canPlanAsConsumer =
    definition.status === 'published' &&
    (await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin))
  if (!canPlanAsConsumer && !(await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin))) {
    throw new Error('You do not have permission to dry-run templates in this workspace.')
  }

  return createAndDispatchDryRun(payload, uid, version, definition, workspaceId, input)
}

export interface StartRunInput {
  templateVersionId: string
  parameters: Record<string, unknown>
}

/**
 * Creates a REAL (`dryRun: false`) action-run for a published template
 * version — the consumer "Run" flow. Run-gated (any active member).
 * Honours the auto-provisioned runner action's `approvalPolicy`: parks as
 * `awaiting-approval` instead of dispatching when the policy requires it,
 * exactly like `self-service/actions.ts`'s `runAction`.
 */
export async function startRun(input: StartRunInput): Promise<{ runId: string; status: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const { version, definition } = await loadVersionAndDefinition(payload, input.templateVersionId)
  const workspaceId = relId(definition.workspace)
  if (!(await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin))) {
    throw new Error('You do not have permission to run templates in this workspace.')
  }
  if (definition.status !== 'published') {
    throw new Error('This template is not published.')
  }

  validateRunParameters(version, input.parameters ?? {})

  const action = await ensureRunnerAction(payload, definition)
  const policy = action.approvalPolicy ?? 'none'
  const needsApproval = policy !== 'none'

  const run = await payload.create({
    collection: 'action-runs',
    data: {
      action: action.id,
      workspace: workspaceId ?? '',
      templateVersion: version.id,
      dryRun: false,
      inputs: input.parameters ?? {},
      status: needsApproval ? 'awaiting-approval' : 'pending',
      triggeredBy: uid,
      trigger: 'manual',
      logs: [
        {
          ts: new Date().toISOString(),
          level: 'info',
          message: needsApproval ? `Run created; awaiting ${policy} approval.` : 'Run created.',
        },
      ],
    },
    overrideAccess: true,
  })

  if (!needsApproval) {
    await executeRun(payload, run.id)
  }

  await payload.update({
    collection: 'template-definitions',
    id: definition.id,
    data: { usageCount: (definition.usageCount ?? 0) + 1 },
    overrideAccess: true,
  })

  const fresh = await payload.findByID({
    collection: 'action-runs',
    id: run.id,
    depth: 0,
    overrideAccess: true,
  })
  return { runId: run.id, status: fresh.status }
}

// ---------------------------------------------------------------------------
// getRun
// ---------------------------------------------------------------------------

/**
 * Loads an action-run (steps/plan/outputs/status), scoped to the caller's
 * workspace access and redacting `ui:secret`-flagged parameter values before
 * returning — see the module docblock's "Secrets" section.
 */
export async function getRun(runId: string): Promise<ActionRun | null> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  let run: ActionRun
  try {
    run = await payload.findByID({ collection: 'action-runs', id: runId, depth: 1, overrideAccess: true })
  } catch {
    return null
  }

  const workspaceId = relId(run.workspace)
  if (!(await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin))) return null

  const versionId = relId(run.templateVersion)
  if (versionId && run.inputs && typeof run.inputs === 'object' && !Array.isArray(run.inputs)) {
    try {
      const version = await payload.findByID({
        collection: 'template-definition-versions',
        id: versionId,
        depth: 0,
        overrideAccess: true,
      })
      const secretKeys = collectSecretParamKeys(version.definitionJson)
      if (secretKeys.size > 0) {
        const rawInputs = run.inputs as Record<string, unknown>
        // The set of actual secret VALUES (not just key names) — used to
        // catch a secret echoed into steps[].output / plan, which are keyed
        // by the action's own output schema, not by the parameter name.
        const secretValues = new Set(
          [...secretKeys].map((k) => rawInputs[k]).filter((v): v is string => typeof v === 'string'),
        )
        return {
          ...run,
          inputs: redactSecrets(rawInputs, secretKeys),
          ...(secretValues.size > 0 && run.steps
            ? { steps: redactSecretValuesDeep(run.steps, secretValues) as ActionRun['steps'] }
            : {}),
          ...(secretValues.size > 0 && run.plan
            ? { plan: redactSecretValuesDeep(run.plan, secretValues) as ActionRun['plan'] }
            : {}),
          // MINOR: `outputs` (links/text, design §output) renders straight
          // to the consumer run-detail page — a secret echoed there must be
          // redacted exactly like steps[].output/plan.
          ...(secretValues.size > 0 && run.outputs
            ? { outputs: redactSecretValuesDeep(run.outputs, secretValues) as ActionRun['outputs'] }
            : {}),
        }
      }
    } catch {
      // Version lookup failing shouldn't hide the run — fall through unredacted-but-scoped.
    }
  }

  return run
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface SaveFixtureInput {
  id?: string
  name: string
  values?: unknown
}

/** Create or update (by `id`) a named sample-input fixture on a definition. Manage-gated. */
export async function saveFixture(
  templateDefinitionId: string,
  fixture: SaveFixtureInput,
): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, templateDefinitionId)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  const name = fixture.name?.trim()
  if (!name) throw new Error('A fixture name is required.')

  const existing = definition.fixtures ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture.values is caller-supplied arbitrary JSON; the generated type is a structural subset of it.
  const values = fixture.values as any
  // Generate the id ourselves rather than relying on Payload's array-row
  // auto-id (which this function has no way to read back deterministically
  // from `update()`'s response for a brand-new row).
  const id = fixture.id && existing.some((f) => f.id === fixture.id) ? fixture.id : crypto.randomUUID()
  const next: TemplateDefinitionDoc['fixtures'] = fixture.id && existing.some((f) => f.id === fixture.id)
    ? existing.map((f) => (f.id === id ? { ...f, name, values } : f))
    : [...existing, { id, name, values }]

  await payload.update({
    collection: 'template-definitions',
    id: templateDefinitionId,
    data: { fixtures: next },
    overrideAccess: true,
  })

  revalidatePath(`/self-service/templates/${templateDefinitionId}/edit`)
  return { id }
}

/** Remove a fixture by id. Manage-gated. */
export async function deleteFixture(templateDefinitionId: string, fixtureId: string): Promise<void> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, templateDefinitionId)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    throw new Error('You do not have permission to author templates in this workspace.')
  }

  const next = (definition.fixtures ?? []).filter((f) => f.id !== fixtureId)
  await payload.update({
    collection: 'template-definitions',
    id: templateDefinitionId,
    data: { fixtures: next },
    overrideAccess: true,
  })

  revalidatePath(`/self-service/templates/${templateDefinitionId}/edit`)
}

// ---------------------------------------------------------------------------
// publish / deprecate
// ---------------------------------------------------------------------------

/**
 * Publishes a definition's current draft version. Gated by
 * {@link canPublishTemplateDefinition} — owner/admin for `visibility:
 * workspace`, platform admin additionally required for `shared`/`public`
 * (design §3.7). The actual publish-gate business rules (validatedAt +
 * succeeded-dry-run-of-this-version) are enforced by
 * `lib/scaffolder/versions.ts`'s `publishVersion`, which this delegates to.
 */
export async function publishTemplateDefinition(id: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, id)
  const workspaceId = relId(definition.workspace)
  if (!(await canPublishTemplateDefinition(payload, uid, workspaceId, definition.visibility, isAdmin))) {
    throw new Error('You do not have permission to publish this template.')
  }

  const versionId = relId(definition.currentVersion)
  if (!versionId) throw new Error('This template has no draft version to publish.')

  await publishVersion(payload, {
    definitionId: id,
    versionId,
    actor: { userId: uid, isPlatformAdmin: isAdmin },
  })

  revalidatePath('/self-service/templates')
  revalidatePath(`/self-service/templates/${id}/edit`)
  return { id }
}

/** Deprecates a published (or draft) template. Manage-gated. */
export async function deprecateTemplateDefinition(id: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, id)
  if (!(await canManageTemplateDefinitions(payload, uid, relId(definition.workspace), isAdmin))) {
    throw new Error('You do not have permission to manage this template.')
  }

  await deprecateDefinition(payload, { definitionId: id, userId: uid })

  revalidatePath('/self-service/templates')
  revalidatePath(`/self-service/templates/${id}/edit`)
  return { id }
}

// ---------------------------------------------------------------------------
// YAML export / import
// ---------------------------------------------------------------------------

/** Exports a definition's CURRENT version as YAML text. Same read gate as {@link getTemplateDefinition}. */
export async function exportTemplateDefinitionYaml(id: string): Promise<string> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  const isAdmin = await currentUserIsPlatformAdmin()

  const definition = await loadDefinitionOrThrow(payload, id)
  const workspaceId = relId(definition.workspace)
  const allowed =
    definition.status === 'published'
      ? await canRunTemplateDefinition(payload, uid, workspaceId, isAdmin)
      : await canManageTemplateDefinitions(payload, uid, workspaceId, isAdmin)
  if (!allowed) throw new Error('Template definition not found')

  const versionId = relId(definition.currentVersion)
  if (!versionId) throw new Error('This template has no version to export.')

  const version = await payload.findByID({
    collection: 'template-definition-versions',
    id: versionId,
    depth: 0,
    overrideAccess: true,
  })

  return yaml.stringify(version.definitionJson)
}

export interface ImportTemplateDefinitionYamlResult {
  definitionJson: DefinitionJson
}

/**
 * Parses + schema-validates YAML text into a definition document. Pure —
 * does NOT persist; the caller feeds the result into the builder state and
 * saves via {@link saveTemplateDefinitionDraft} when ready. Throws with a
 * readable message on invalid YAML or a schema mismatch.
 */
export async function importTemplateDefinitionYaml(
  yamlText: string,
): Promise<ImportTemplateDefinitionYamlResult> {
  await requireUserId()

  let parsedYaml: unknown
  try {
    parsedYaml = yaml.parse(yamlText)
  } catch (err) {
    throw new Error(`Invalid YAML: ${(err as Error).message}`)
  }

  const parsed = TemplateDefinitionSchema.safeParse(parsedYaml)
  if (!parsed.success) {
    throw new Error(
      `Invalid template definition: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }

  return { definitionJson: parsed.data }
}
