'use client';

import { useWorkflowProgress } from '@/hooks/useWorkflowProgress';
import { WorkflowStatus } from '@/lib/proto/temporal_pb';
import type { WorkflowStep } from '@/lib/proto/temporal_pb';
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface GenerationMonitorProps {
  /**
   * Workflow ID to monitor
   */
  workflowId: string;
  /**
   * Run ID of the workflow execution
   */
  runId: string;
  /**
   * Callback when workflow completes successfully
   */
  onComplete?: (workflowId: string, runId: string) => void;
  /**
   * Callback when workflow fails
   */
  onError?: (error: string) => void;
  /**
   * Polling interval in milliseconds (default: 3000)
   */
  pollingInterval?: number;
}

/**
 * Component for monitoring Temporal workflow progress in real-time
 * Displays workflow status, progress, steps, and allows cancellation
 */
export function GenerationMonitor({
  workflowId,
  runId,
  onComplete,
  onError,
  pollingInterval = 3000,
}: GenerationMonitorProps) {
  const { status, isLoading, error, cancel } = useWorkflowProgress({
    workflowId,
    runId,
    pollingInterval,
    onComplete,
    onError,
  });

  /**
   * Calculate progress percentage based on completed steps
   */
  const calculateProgress = (): number => {
    if (!status?.steps || status.steps.length === 0) {
      return 0;
    }

    const completedSteps = status.steps.filter(
      (step) => step.status === WorkflowStatus.COMPLETED,
    ).length;

    return Math.round((completedSteps / status.steps.length) * 100);
  };

  /**
   * Format elapsed time
   */
  const formatElapsedTime = (): string => {
    if (!status?.startedAt) {
      return '0s';
    }

    const startTime = Number(status.startedAt.seconds) * 1000;
    const endTime = status.completedAt
      ? Number(status.completedAt.seconds) * 1000
      : Date.now();
    const elapsed = Math.floor((endTime - startTime) / 1000);

    if (elapsed < 60) {
      return `${elapsed}s`;
    }

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  /**
   * Get status badge color and text
   */
  const getStatusDisplay = () => {
    if (!status) {
      return { color: 'text-muted-foreground', text: 'Loading...', icon: Loader2 };
    }

    switch (status.status) {
      case WorkflowStatus.PENDING:
        return { color: 'text-yellow-600', text: 'Pending', icon: Clock };
      case WorkflowStatus.RUNNING:
        return { color: 'text-blue-600', text: 'Running', icon: Loader2 };
      case WorkflowStatus.COMPLETED:
        return { color: 'text-green-600', text: 'Completed', icon: CheckCircle2 };
      case WorkflowStatus.FAILED:
        return { color: 'text-red-600', text: 'Failed', icon: XCircle };
      case WorkflowStatus.CANCELLED:
        return { color: 'text-gray-600', text: 'Cancelled', icon: Ban };
      case WorkflowStatus.TIMED_OUT:
        return { color: 'text-orange-600', text: 'Timed Out', icon: AlertCircle };
      default:
        return { color: 'text-muted-foreground', text: 'Unknown', icon: AlertCircle };
    }
  };

  /**
   * Get step status icon
   */
  const getStepIcon = (step: WorkflowStep) => {
    switch (step.status) {
      case WorkflowStatus.COMPLETED:
        return (
          <CheckCircle2
            className="h-5 w-5 text-green-600"
            data-testid="step-status-completed"
          />
        );
      case WorkflowStatus.RUNNING:
        return (
          <Loader2
            className="h-5 w-5 text-blue-600 animate-spin"
            data-testid="step-status-running"
          />
        );
      case WorkflowStatus.FAILED:
        return (
          <XCircle
            className="h-5 w-5 text-red-600"
            data-testid="step-status-failed"
          />
        );
      case WorkflowStatus.PENDING:
      default:
        return (
          <Clock
            className="h-5 w-5 text-gray-400"
            data-testid="step-status-pending"
          />
        );
    }
  };

  const statusDisplay = getStatusDisplay();
  const StatusIcon = statusDisplay.icon;
  const progress = calculateProgress();
  const elapsedTime = formatElapsedTime();

  const isRunning =
    status?.status === WorkflowStatus.RUNNING ||
    status?.status === WorkflowStatus.PENDING;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon
              className={cn(
                'h-6 w-6',
                statusDisplay.color,
                status?.status === WorkflowStatus.RUNNING && 'animate-spin',
              )}
            />
            <div>
              <CardTitle className="text-lg">Repository Generation</CardTitle>
              <CardDescription>
                Status: <span className={statusDisplay.color}>{statusDisplay.text}</span>
                {status?.startedAt && (
                  <span className="ml-3 text-sm">
                    Elapsed: {elapsedTime}
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancel()}
            >
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">
              Error: {error.message}
            </p>
          </div>
        )}

        {status?.errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">{status.errorMessage}</p>
          </div>
        )}

        {status?.steps && status.steps.length > 0 && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  Progress: {progress}%
                </span>
                <span className="text-sm text-muted-foreground">
                  {status.steps.filter((s) => s.status === WorkflowStatus.COMPLETED).length} of{' '}
                  {status.steps.length} steps completed
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Steps</h4>
              <div className="space-y-2">
                {status.steps.map((step, index) => (
                  <div
                    key={`${step.stepName}-${index}`}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-md border',
                      step.status === WorkflowStatus.RUNNING && 'bg-blue-50 border-blue-200',
                      step.status === WorkflowStatus.COMPLETED && 'bg-green-50 border-green-200',
                      step.status === WorkflowStatus.FAILED && 'bg-red-50 border-red-200',
                      step.status === WorkflowStatus.PENDING && 'bg-gray-50 border-gray-200',
                    )}
                  >
                    {getStepIcon(step)}
                    <div className="flex-1">
                      <p className="text-sm font-medium">{step.stepName}</p>
                      {step.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">{step.errorMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {(!status?.steps || status.steps.length === 0) && !isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No workflow steps available yet</p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
