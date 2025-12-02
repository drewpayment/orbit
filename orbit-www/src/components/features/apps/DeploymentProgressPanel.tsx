'use client'

import { useState, useEffect, useCallback } from 'react'
import { ProgressSteps } from './ProgressSteps'
import { getDeploymentWorkflowProgress } from '@/app/actions/deployments'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Deployment } from '@/payload-types'

interface DeploymentProgressPanelProps {
  deployment: Deployment
  isExpanded: boolean
  onRetry: () => void
}

interface ProgressData {
  currentStep: string
  stepsTotal: number
  stepsCurrent: number
  message: string
  status: string
}

export function DeploymentProgressPanel({
  deployment,
  isExpanded,
  onRetry,
}: DeploymentProgressPanelProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  const status = deployment.status || 'pending'
  const workflowId = deployment.workflowId

  const fetchProgress = useCallback(async () => {
    if (!workflowId) return

    try {
      const result = await getDeploymentWorkflowProgress(workflowId)
      if (result.success) {
        setProgress({
          currentStep: result.currentStep || '',
          stepsTotal: result.stepsTotal || 5,
          stepsCurrent: result.stepsCurrent || 0,
          message: result.message || '',
          status: result.status || 'running',
        })
        setError(null)
      } else {
        setError(result.error || 'Failed to fetch progress')
      }
    } catch (err) {
      setError('Connection error')
    }
  }, [workflowId])

  useEffect(() => {
    if (!isExpanded || !workflowId) return
    if (status !== 'deploying') return

    setIsPolling(true)
    fetchProgress()

    const interval = setInterval(fetchProgress, 2000)

    return () => {
      clearInterval(interval)
      setIsPolling(false)
    }
  }, [isExpanded, workflowId, status, fetchProgress])

  // No workflow yet
  if (!workflowId && status === 'pending') {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Click Deploy to start this deployment.
      </div>
    )
  }

  // Show error state
  if (status === 'failed') {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3 rounded-md bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-800">Deployment Failed</p>
            <p className="text-sm text-red-700 mt-1">
              {deployment.deploymentError || 'An unknown error occurred'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry Deployment
        </Button>
      </div>
    )
  }

  // Show progress
  if (status === 'deploying' && progress) {
    return (
      <div className="p-4">
        <ProgressSteps
          currentStep={progress.currentStep}
          stepsTotal={progress.stepsTotal}
          stepsCurrent={progress.stepsCurrent}
          message={progress.message}
          status={progress.status}
        />
        {error && (
          <p className="text-sm text-amber-600 mt-2">
            {error} - Retrying...
          </p>
        )}
      </div>
    )
  }

  // Generated state - will add file preview in Phase 4
  if (status === 'generated') {
    return (
      <div className="p-4">
        <div className="rounded-md bg-purple-50 p-4">
          <p className="font-medium text-purple-800">Files Generated</p>
          <p className="text-sm text-purple-700 mt-1">
            Deployment files have been generated. Review and commit below.
          </p>
        </div>
        {/* GeneratedFilesView will go here */}
      </div>
    )
  }

  // Deployed state
  if (status === 'deployed') {
    return (
      <div className="p-4">
        <div className="rounded-md bg-green-50 p-4">
          <p className="font-medium text-green-800">Deployed Successfully</p>
          {deployment.target?.url && (
            <a
              href={deployment.target.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-700 hover:underline mt-1 block"
            >
              {deployment.target.url}
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="text-sm text-muted-foreground p-4">
      Loading...
    </div>
  )
}
