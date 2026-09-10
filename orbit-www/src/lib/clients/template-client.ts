/**
 * Template Service gRPC Client (v2 Scaffolder engine, phase-1 plan §8.2/§9.2).
 *
 * Uses @connectrpc/connect-web (NOT connect-node) to avoid Next.js webpack
 * bundling issues, same pattern as `lib/clients/launch-client.ts`. The Go
 * repository service supports both gRPC and Connect protocols on the same
 * port.
 */

import { create } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  TemplateService,
  StartScaffolderRunRequestSchema,
  GetRunProgressRequestSchema,
  CancelRunRequestSchema,
  ListActionsRequestSchema,
  ResolveScaffolderApprovalRequestSchema,
  type StartScaffolderRunResponse,
  type GetRunProgressResponse,
  type CancelRunResponse,
  type ListActionsResponse,
  type ResolveScaffolderApprovalResponse,
} from '@/lib/proto/idp/template/v1/template_pb'
import type { JsonObject } from '@bufbuild/protobuf'
import { authInterceptor } from '../grpc/auth-interceptor'

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
  interceptors: [authInterceptor],
})

export const templateClient = createClient(TemplateService, transport)

/**
 * Start a new v2 ScaffolderWorkflow run for a published template-definition
 * version. `runId` is the pre-created `action-runs` doc id (orbit-www owns
 * run identity; the Go worker writes progress back via
 * /api/internal/action-runs/[id]/status).
 */
export async function startScaffolderRun(input: {
  runId: string
  definitionVersionId: string
  workspaceId: string
  userId: string
  parameters: JsonObject
  dryRun: boolean
}): Promise<StartScaffolderRunResponse> {
  const request = create(StartScaffolderRunRequestSchema, {
    runId: input.runId,
    definitionVersionId: input.definitionVersionId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    parameters: input.parameters,
    dryRun: input.dryRun,
  })
  return templateClient.startScaffolderRun(request)
}

/** Get the current step-by-step progress of a scaffolder run by workflow id. */
export async function getRunProgress(workflowId: string): Promise<GetRunProgressResponse> {
  const request = create(GetRunProgressRequestSchema, { workflowId })
  return templateClient.getRunProgress(request)
}

/** Cancel an in-progress scaffolder run by workflow id. */
export async function cancelScaffolderRun(workflowId: string): Promise<CancelRunResponse> {
  const request = create(CancelRunRequestSchema, { workflowId })
  return templateClient.cancelRun(request)
}

/** List the action registry descriptors known to the worker. */
export async function listActions(): Promise<ListActionsResponse> {
  const request = create(ListActionsRequestSchema, {})
  return templateClient.listActions(request)
}

/**
 * Resolve an `approval:request` step's human-in-the-loop gate (Phase 4 Task
 * C). Callers MUST check the caller is authorized to approve (workspace
 * owner/admin, or listed in the step's `approvers` —
 * `lib/templates/authz.ts#canApproveScaffolderStep`) BEFORE calling this: the
 * RPC itself only proves tenant isolation, not who may approve.
 *
 * `workspaceId` is required — not for the Go server's own authorization
 * (`authorizeScaffolderRun` resolves the run's true workspace from the
 * Temporal workflow memo, not from this field), but because
 * `lib/grpc/auth-interceptor.ts` reads a `workspaceId` field off the request
 * message to mint the outbound service token's `wid` claim. Without it the
 * token carries no workspace claim and the server's `EnforceWorkspace` check
 * rejects the call with `PermissionDenied` even for an authorized caller.
 */
export async function resolveScaffolderApproval(input: {
  workflowId: string
  approvalId: string
  approved: boolean
  approverId: string
  comment?: string
  workspaceId: string
}): Promise<ResolveScaffolderApprovalResponse> {
  const request = create(ResolveScaffolderApprovalRequestSchema, {
    workflowId: input.workflowId,
    approvalId: input.approvalId,
    approved: input.approved,
    approverId: input.approverId,
    comment: input.comment ?? '',
    workspaceId: input.workspaceId,
  })
  return templateClient.resolveScaffolderApproval(request)
}
