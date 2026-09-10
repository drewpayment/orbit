export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * POST /api/internal/agent-runs
 *
 * Creates the AgentRuns row for a template-run `agent:run` step's child
 * InfrastructureAgentWorkflow (Phase 4 Task D,
 * docs/plans/2026-09-10-template-authoring-phase-4-platform-steps.md §4).
 *
 * Unlike the normal chat UI flow (src/app/actions/infra-agent.ts), which
 * starts the agent workflow via the AgentService gRPC unary and then writes
 * the row itself, ScaffolderWorkflow starts InfrastructureAgentWorkflow
 * directly as a Temporal child workflow — so it needs a headless way to
 * both create the row and resolve which LLM provider to use, since a
 * template step supplies neither.
 *
 * Body: { workspaceId, userId, workflowId, title?, initialPrompt }
 *
 * Resolves the workspace's default LLM provider (`isDefault: true`,
 * falling back to the first configured provider for that workspace); 422s
 * with code NO_LLM_PROVIDER if the workspace has none configured — the
 * caller (ScaffolderAgentRunActivities.CreateAgentRun) treats that as
 * non-retryable, since no retry fixes a missing provider.
 *
 * Idempotent on workflowId (unique-indexed on the collection): a retried
 * Temporal activity attempt returns the existing row rather than erroring
 * on the duplicate key.
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { workspaceId, userId, workflowId, title, initialPrompt } = body ?? {}
  if (!workspaceId || !workflowId || !userId || !initialPrompt) {
    return NextResponse.json(
      { error: 'workspaceId, userId, workflowId, initialPrompt required' },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })

    const existing = await payload.find({
      collection: 'agent-runs',
      where: { workflowId: { equals: workflowId } },
      limit: 1,
      overrideAccess: true,
    })
    const existingDoc = existing.docs[0]
    if (existingDoc) {
      const llmProviderId =
        typeof existingDoc.llmProvider === 'string'
          ? existingDoc.llmProvider
          : existingDoc.llmProvider?.id
      return NextResponse.json({ agentRunId: existingDoc.id, llmProviderId: llmProviderId ?? '' })
    }

    const defaultProvider = await payload.find({
      collection: 'llm-providers',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { isDefault: { equals: true } }],
      },
      limit: 1,
      overrideAccess: true,
    })
    let provider = defaultProvider.docs[0]
    if (!provider) {
      const anyProvider = await payload.find({
        collection: 'llm-providers',
        where: { workspace: { equals: workspaceId } },
        limit: 1,
        sort: 'createdAt',
        overrideAccess: true,
      })
      provider = anyProvider.docs[0]
    }
    if (!provider) {
      return NextResponse.json(
        { error: 'no LLM provider configured for this workspace', code: 'NO_LLM_PROVIDER' },
        { status: 422 },
      )
    }

    const doc = await payload.create({
      collection: 'agent-runs',
      data: {
        workspace: workspaceId,
        workflowId,
        title: title || String(initialPrompt).slice(0, 80),
        initialPrompt,
        llmProvider: provider.id,
        status: 'starting',
        startedBy: userId,
        startedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return NextResponse.json({ agentRunId: doc.id, llmProviderId: provider.id }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
