import { create } from '@bufbuild/protobuf';
import {
  GetWorkflowStatusRequestSchema,
  CancelWorkflowRequestSchema,
  type GetWorkflowStatusResponse,
  type CancelWorkflowResponse,
} from '@/lib/proto/temporal_pb';
import { WorkflowService } from '@/lib/proto/temporal_connect';
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

/**
 * Create a transport for the workflow service
 * This uses Connect-ES to communicate with the gRPC-Web backend
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_WORKFLOW_SERVICE_URL || 'http://localhost:8081',
});

/**
 * Create the workflow service client
 */
const client = createPromiseClient(WorkflowService, transport);

/**
 * Workflow client for interacting with Temporal workflows
 */
export const workflowClient = {
  /**
   * Get the current status of a workflow
   * @param workflowId - The workflow ID
   * @param runId - The run ID
   * @returns The workflow status response
   */
  async getWorkflowStatus(
    workflowId: string,
    runId: string,
  ): Promise<GetWorkflowStatusResponse> {
    const request = create(GetWorkflowStatusRequestSchema, {
      workflowId,
      runId,
    });

    return await client.getWorkflowStatus(request);
  },

  /**
   * Cancel a running workflow
   * @param workflowId - The workflow ID
   * @param runId - The run ID
   * @param reason - The reason for cancellation
   * @returns The cancel response
   */
  async cancelWorkflow(
    workflowId: string,
    runId: string,
    reason: string = 'User cancelled',
  ): Promise<CancelWorkflowResponse> {
    const request = create(CancelWorkflowRequestSchema, {
      workflowId,
      runId,
      reason,
    });

    return await client.cancelWorkflow(request);
  },
};
