'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export interface WorkflowStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface WorkflowStatus {
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  steps: WorkflowStep[]
  result?: {
    repositoryId?: string
    gitUrl?: string
  }
  error?: string
  startedAt: string
  completedAt?: string
}

// Step definitions for template instantiation
const WORKFLOW_STEPS = [
  { name: 'Clone template repository', key: 'clone' },
  { name: 'Apply template variables', key: 'apply' },
  { name: 'Initialize Git repository', key: 'init' },
  { name: 'Prepare GitHub remote', key: 'prepare' },
  { name: 'Push to remote repository', key: 'push' },
]

/**
 * Get workflow status
 * TODO: Connect to actual Temporal API when backend is ready
 */
export async function getWorkflowStatus(workflowId: string): Promise<WorkflowStatus | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  // TODO: Connect to Temporal gRPC service to get actual status
  // For now, simulate progress based on workflow ID
  // In production, this would call the WorkflowService.GetWorkflowStatus RPC

  // Simulate workflow progress for demo purposes
  const createdTime = parseInt(workflowId.replace('placeholder-', ''), 10) || Date.now()
  const elapsed = Date.now() - createdTime
  const stepDuration = 3000 // 3 seconds per step for demo
  const currentStep = Math.min(Math.floor(elapsed / stepDuration), WORKFLOW_STEPS.length)

  const isComplete = currentStep >= WORKFLOW_STEPS.length
  const steps: WorkflowStep[] = WORKFLOW_STEPS.map((step, index) => {
    if (index < currentStep) {
      return {
        name: step.name,
        status: 'completed' as const,
        startedAt: new Date(createdTime + index * stepDuration).toISOString(),
        completedAt: new Date(createdTime + (index + 1) * stepDuration).toISOString(),
      }
    } else if (index === currentStep && !isComplete) {
      return {
        name: step.name,
        status: 'running' as const,
        startedAt: new Date(createdTime + index * stepDuration).toISOString(),
      }
    } else {
      return {
        name: step.name,
        status: 'pending' as const,
      }
    }
  })

  return {
    workflowId,
    status: isComplete ? 'completed' : 'running',
    steps,
    result: isComplete ? {
      repositoryId: 'new-repo-id',
      gitUrl: 'https://github.com/org/new-repo',
    } : undefined,
    startedAt: new Date(createdTime).toISOString(),
    completedAt: isComplete ? new Date(createdTime + WORKFLOW_STEPS.length * stepDuration).toISOString() : undefined,
  }
}
