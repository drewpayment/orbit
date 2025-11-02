import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GenerationMonitor } from './GenerationMonitor';
import { WorkflowStatus } from '@/lib/proto/temporal_pb';
import type { GetWorkflowStatusResponse } from '@/lib/proto/temporal_pb';

// Mock the workflow client - must be defined before vi.mock for hoisting
vi.mock('@/lib/temporal/workflow-client', () => ({
  workflowClient: {
    getWorkflowStatus: vi.fn(),
    cancelWorkflow: vi.fn(),
  },
}));

// Import the mocked client after the mock is set up
import { workflowClient } from '@/lib/temporal/workflow-client';

describe('GenerationMonitor', () => {
  const mockWorkflowId = 'wf-123';
  const mockRunId = 'run-456';
  const mockOnComplete = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders pending status correctly', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.PENDING,
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/pending/i)).toBeTruthy();
    });
  });

  it('renders running status with progress bar', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      steps: [
        {
          stepName: 'Clone template',
          status: WorkflowStatus.COMPLETED,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          completedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          metadata: {},
        },
        {
          stepName: 'Apply variables',
          status: WorkflowStatus.RUNNING,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          metadata: {},
        },
      ],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeTruthy();
      expect(screen.getByText('Clone template')).toBeTruthy();
      expect(screen.getByText('Apply variables')).toBeTruthy();
    });

    // Should show progress bar with 50% completion (1 of 2 steps done)
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeTruthy();
    // Check the progress text instead of aria attribute
    expect(screen.getByText('Progress: 50%')).toBeTruthy();
  });

  it('renders completed status and calls onComplete', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.COMPLETED,
      completedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
      steps: [
        {
          stepName: 'Clone template',
          status: WorkflowStatus.COMPLETED,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          completedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          metadata: {},
        },
      ],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/completed/i).length).toBeGreaterThan(0);
      expect(mockOnComplete).toHaveBeenCalledWith(mockWorkflowId, mockRunId);
    });
  });

  it('renders failed status with error message and calls onError', async () => {
    const errorMessage = 'Template not found';
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.FAILED,
      errorMessage,
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeTruthy();
      expect(screen.getByText(errorMessage)).toBeTruthy();
      expect(mockOnError).toHaveBeenCalledWith(errorMessage);
    });
  });

  it('renders cancelled status correctly', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.CANCELLED,
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/cancelled/i)).toBeTruthy();
    });
  });

  it('renders timed out status correctly', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.TIMED_OUT,
      errorMessage: 'Workflow timed out after 10 minutes',
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/timed out/i).length).toBeGreaterThan(0);
    });
  });

  it('polls for updates every 3 seconds when running', async () => {
    vi.useFakeTimers();

    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    // Initial call
    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(1);
    });

    // Advance timer by 3 seconds and run timers
    await vi.advanceTimersByTimeAsync(3000);

    // Should poll again
    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(2);
    });

    // Advance timer by another 3 seconds
    await vi.advanceTimersByTimeAsync(3000);

    // Should poll a third time
    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(3);
    });

    vi.useRealTimers();
  });

  it('stops polling when workflow completes', async () => {
    vi.useFakeTimers();

    const runningResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      steps: [],
    };

    const completedResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.COMPLETED,
      completedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus)
      .mockResolvedValueOnce(runningResponse as GetWorkflowStatusResponse)
      .mockResolvedValueOnce(completedResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    // Initial call
    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(1);
    });

    // Advance timer by 3 seconds - should poll and get completed status
    await vi.advanceTimersByTimeAsync(3000);

    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/completed/i)).toBeTruthy();
    });

    // Advance timer by another 3 seconds - should NOT poll again
    await vi.advanceTimersByTimeAsync(3000);

    await vi.waitFor(() => {
      expect(workflowClient.getWorkflowStatus).toHaveBeenCalledTimes(2);
    });

    vi.useRealTimers();
  });

  it('allows cancelling the workflow', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);
    vi.mocked(workflowClient.cancelWorkflow).mockResolvedValue({ success: true, message: 'Cancelled' });

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeTruthy();
    });

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(workflowClient.cancelWorkflow).toHaveBeenCalledWith(mockWorkflowId, mockRunId, 'User cancelled');
    });
  });

  it('displays elapsed time correctly', async () => {
    const startTime = Date.now() - 65000; // Started 65 seconds ago
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      startedAt: { seconds: BigInt(Math.floor(startTime / 1000)), nanos: 0 },
      steps: [],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      // Should show "1m 5s" or similar
      expect(screen.getByText(/1m/i)).toBeTruthy();
    });
  });

  it('shows step status indicators', async () => {
    const mockResponse: Partial<GetWorkflowStatusResponse> = {
      workflowId: mockWorkflowId,
      runId: mockRunId,
      status: WorkflowStatus.RUNNING,
      steps: [
        {
          stepName: 'Clone template',
          status: WorkflowStatus.COMPLETED,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          completedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          metadata: {},
        },
        {
          stepName: 'Apply variables',
          status: WorkflowStatus.RUNNING,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          metadata: {},
        },
        {
          stepName: 'Initialize Git',
          status: WorkflowStatus.PENDING,
          metadata: {},
        },
        {
          stepName: 'Failed step',
          status: WorkflowStatus.FAILED,
          startedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          errorMessage: 'Step failed',
          metadata: {},
        },
      ],
    };

    vi.mocked(workflowClient.getWorkflowStatus).mockResolvedValue(mockResponse as GetWorkflowStatusResponse);

    render(
      <GenerationMonitor
        workflowId={mockWorkflowId}
        runId={mockRunId}
        onComplete={mockOnComplete}
        onError={mockOnError}
      />
    );

    await waitFor(() => {
      // Check for all step names
      expect(screen.getByText('Clone template')).toBeTruthy();
      expect(screen.getByText('Apply variables')).toBeTruthy();
      expect(screen.getByText('Initialize Git')).toBeTruthy();
      expect(screen.getByText('Failed step')).toBeTruthy();

      // Check for status indicators (icons or badges)
      // These will be verified based on the implementation
      const completedIcon = screen.getAllByTestId('step-status-completed');
      expect(completedIcon.length).toBeGreaterThan(0);

      const runningIcon = screen.getAllByTestId('step-status-running');
      expect(runningIcon.length).toBeGreaterThan(0);

      const pendingIcon = screen.getAllByTestId('step-status-pending');
      expect(pendingIcon.length).toBeGreaterThan(0);

      const failedIcon = screen.getAllByTestId('step-status-failed');
      expect(failedIcon.length).toBeGreaterThan(0);
    });
  });
});
