import { useState, useEffect, useCallback, useRef } from 'react';
import { workflowClient } from '@/lib/temporal/workflow-client';
import { WorkflowStatus } from '@/lib/proto/temporal_pb';
import type { GetWorkflowStatusResponse } from '@/lib/proto/temporal_pb';

interface UseWorkflowProgressOptions {
  /**
   * Workflow ID to monitor
   */
  workflowId: string;
  /**
   * Run ID of the workflow execution
   */
  runId: string;
  /**
   * Polling interval in milliseconds (default: 3000)
   */
  pollingInterval?: number;
  /**
   * Whether to start polling immediately (default: true)
   */
  enabled?: boolean;
  /**
   * Callback when workflow completes successfully
   */
  onComplete?: (workflowId: string, runId: string) => void;
  /**
   * Callback when workflow fails
   */
  onError?: (error: string) => void;
}

interface UseWorkflowProgressReturn {
  /**
   * Current workflow status
   */
  status: GetWorkflowStatusResponse | null;
  /**
   * Whether the workflow is still loading
   */
  isLoading: boolean;
  /**
   * Any error that occurred while fetching status
   */
  error: Error | null;
  /**
   * Cancel the workflow
   */
  cancel: (reason?: string) => Promise<void>;
  /**
   * Manually refresh the workflow status
   */
  refresh: () => Promise<void>;
}

/**
 * Hook for polling Temporal workflow progress
 * Automatically polls for updates at the specified interval and stops when the workflow is no longer running
 */
export function useWorkflowProgress(
  options: UseWorkflowProgressOptions,
): UseWorkflowProgressReturn {
  const {
    workflowId,
    runId,
    pollingInterval = 3000,
    enabled = true,
    onComplete,
    onError,
  } = options;

  const [status, setStatus] = useState<GetWorkflowStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef<boolean>(true);
  const callbacksRef = useRef({ onComplete, onError });

  // Keep callbacks up to date without triggering useEffect dependencies
  useEffect(() => {
    callbacksRef.current = { onComplete, onError };
  }, [onComplete, onError]);

  /**
   * Fetch the workflow status
   */
  const fetchStatus = useCallback(async () => {
    if (!enabled || !workflowId || !runId) {
      return;
    }

    try {
      const response = await workflowClient.getWorkflowStatus(workflowId, runId);

      if (!mountedRef.current) {
        return;
      }

      setStatus(response);
      setError(null);
      setIsLoading(false);

      // Check if workflow has reached a terminal state
      const isTerminal =
        response.status === WorkflowStatus.COMPLETED ||
        response.status === WorkflowStatus.FAILED ||
        response.status === WorkflowStatus.CANCELLED ||
        response.status === WorkflowStatus.TIMED_OUT;

      // Call appropriate callbacks
      if (response.status === WorkflowStatus.COMPLETED) {
        callbacksRef.current.onComplete?.(workflowId, runId);
      } else if (
        response.status === WorkflowStatus.FAILED ||
        response.status === WorkflowStatus.TIMED_OUT
      ) {
        callbacksRef.current.onError?.(
          response.errorMessage || 'Workflow failed',
        );
      }

      // Stop polling if workflow is in a terminal state
      if (isTerminal && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      const errorMessage = err instanceof Error ? err : new Error('Failed to fetch workflow status');
      setError(errorMessage);
      setIsLoading(false);
    }
  }, [workflowId, runId, enabled]);

  /**
   * Cancel the workflow
   */
  const cancel = useCallback(
    async (reason: string = 'User cancelled') => {
      try {
        await workflowClient.cancelWorkflow(workflowId, runId, reason);
        // Immediately refresh to get updated status
        await fetchStatus();
      } catch (err) {
        const errorMessage = err instanceof Error ? err : new Error('Failed to cancel workflow');
        setError(errorMessage);
      }
    },
    [workflowId, runId, fetchStatus],
  );

  /**
   * Set up polling
   */
  useEffect(() => {
    if (!enabled || !workflowId || !runId) {
      return;
    }

    // Initial fetch
    fetchStatus();

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      fetchStatus();
    }, pollingInterval);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [workflowId, runId, enabled, pollingInterval, fetchStatus]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    status,
    isLoading,
    error,
    cancel,
    refresh: fetchStatus,
  };
}
