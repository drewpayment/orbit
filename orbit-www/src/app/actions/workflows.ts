'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getInstantiationProgress } from './templates'

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
 * Get workflow status from gRPC service
 * Falls back to mock progress if service unavailable
 */
export async function getWorkflowStatus(workflowId: string): Promise<WorkflowStatus | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  // Call the real gRPC service via getInstantiationProgress
  const progressResult = await getInstantiationProgress(workflowId)

  if (progressResult.progress) {
    const progress = progressResult.progress

    // Map progress to workflow steps
    const completedPercent = progress.progressPercent
    const completedSteps = Math.floor((completedPercent / 100) * WORKFLOW_STEPS.length)

    const steps: WorkflowStep[] = WORKFLOW_STEPS.map((step, index) => {
      if (index < completedSteps) {
        return {
          name: step.name,
          status: 'completed' as const,
          completedAt: new Date().toISOString(),
        }
      } else if (index === completedSteps && progress.status === 'running') {
        return {
          name: step.name,
          status: 'running' as const,
          startedAt: new Date().toISOString(),
        }
      } else {
        return {
          name: step.name,
          status: 'pending' as const,
        }
      }
    })

    // If failed, mark the current step as failed
    if (progress.status === 'failed' && completedSteps < WORKFLOW_STEPS.length) {
      steps[completedSteps] = {
        ...steps[completedSteps],
        status: 'failed',
        error: progress.errorMessage,
      }
    }

    return {
      workflowId,
      status: progress.status,
      steps,
      result: progress.status === 'completed' ? {
        repositoryId: progress.resultRepoName,
        gitUrl: progress.resultRepoUrl,
      } : undefined,
      error: progress.errorMessage,
      startedAt: new Date().toISOString(),
      completedAt: progress.status === 'completed' ? new Date().toISOString() : undefined,
    }
  }

  // Fallback to mock if gRPC fails (shouldn't happen with proper error handling in getInstantiationProgress)
  return null
}
