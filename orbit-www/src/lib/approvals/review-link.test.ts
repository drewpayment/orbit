import { describe, expect, it } from 'vitest'
import { buildReviewLink } from './review-link'

describe('buildReviewLink', () => {
  it('routes a scaffolder approval:request gate to the template run page', () => {
    const link = buildReviewLink({
      kind: 'custom',
      templateDefinitionId: 'tmpl-123',
      workspaceSlug: 'acme',
      runId: 'run-456',
      approvalId: 'run-456:gate',
    })

    expect(link).toBe('/self-service/templates/tmpl-123/run/run-456')
  })

  it('falls back to the template definition page when the gate has no run id', () => {
    const link = buildReviewLink({
      kind: 'custom',
      templateDefinitionId: 'tmpl-123',
      workspaceSlug: 'acme',
      runId: '',
      approvalId: 'run-456:gate',
    })

    expect(link).toBe('/self-service/templates/tmpl-123')
  })

  it('routes a "custom" row without a template definition id to the infra-agent chat thread', () => {
    const link = buildReviewLink({
      kind: 'custom',
      templateDefinitionId: null,
      workspaceSlug: 'acme',
      runId: 'run-789',
      approvalId: 'approval-1',
    })

    expect(link).toBe('/workspaces/acme/infra-agent/run-789#approval-approval-1')
  })

  it('routes tool_registration/destructive_command/proposal gates to the infra-agent chat thread', () => {
    for (const kind of ['tool_registration', 'destructive_command', 'proposal']) {
      const link = buildReviewLink({
        kind,
        templateDefinitionId: null,
        workspaceSlug: 'acme',
        runId: 'run-789',
        approvalId: 'approval-1',
      })
      expect(link).toBe('/workspaces/acme/infra-agent/run-789#approval-approval-1')
    }
  })

  it('falls back to the workspace infra-agent page when there is no run id', () => {
    const link = buildReviewLink({
      kind: 'tool_registration',
      templateDefinitionId: null,
      workspaceSlug: 'acme',
      runId: '',
      approvalId: 'approval-1',
    })

    expect(link).toBe('/workspaces/acme/infra-agent')
  })
})
