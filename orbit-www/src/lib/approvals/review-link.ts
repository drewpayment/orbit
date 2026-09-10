/**
 * Builds the /platform/approvals "Review" link for one pending-approvals
 * row. Two shapes exist:
 *
 * - A scaffolder `approval:request` gate (kind "custom" with a
 *   `templateDefinitionId` payload field — see
 *   temporal-workflows/internal/activities/scaffolder_approval_activity.go)
 *   links to the template run page,
 *   `/self-service/templates/<templateDefinitionId>/run/<runId>` — the run
 *   page itself renders the pending `ScaffolderApprovalGate` card.
 * - Every other row (infra-agent tool_registration, destructive_command,
 *   proposal, and any "custom" row without a template definition id) keeps
 *   the existing infra-agent chat-thread deep link.
 *
 * Pulled out of the approvals page module so it can be unit tested without
 * pulling in Payload/next-navigation server-only imports.
 */
export function buildReviewLink(row: {
  kind: string
  templateDefinitionId: string | null
  workspaceSlug: string
  runId: string
  approvalId: string
}): string {
  if (row.templateDefinitionId) {
    return row.runId
      ? `/self-service/templates/${row.templateDefinitionId}/run/${row.runId}`
      : `/self-service/templates/${row.templateDefinitionId}`
  }
  return row.runId
    ? `/workspaces/${row.workspaceSlug}/infra-agent/${row.runId}#approval-${row.approvalId}`
    : `/workspaces/${row.workspaceSlug}/infra-agent`
}
