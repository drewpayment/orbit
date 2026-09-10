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
 * Resolves the workspace's LLM provider: `isDefault: true` wins outright;
 * with no default set, a workspace with exactly one configured provider
 * uses it implicitly (there is nothing to disambiguate); a workspace with
 * more than one provider and no default is a configuration error the
 * caller must fix, not a guess this route should make — 422s with code
 * AMBIGUOUS_LLM_PROVIDER. 422s with code NO_LLM_PROVIDER if the workspace
 * has none configured. Both are treated as non-retryable by the caller
 * (ScaffolderAgentRunActivities.CreateAgentRun), since no retry fixes
 * either.
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
      // No default set. A single provider is unambiguous and used
      // implicitly; two or more with no default is a configuration gap the
      // workspace owner must resolve (mark one as default) rather than a
      // guess this route should make silently.
      const allProviders = await payload.find({
        collection: 'llm-providers',
        where: { workspace: { equals: workspaceId } },
        limit: 2,
        sort: 'createdAt',
        overrideAccess: true,
      })
      if (allProviders.docs.length > 1) {
        return NextResponse.json(
          {
            error:
              'multiple LLM providers are configured for this workspace with none marked default',
            code: 'AMBIGUOUS_LLM_PROVIDER',
          },
          { status: 422 },
        )
      }
      provider = allProviders.docs[0]
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
