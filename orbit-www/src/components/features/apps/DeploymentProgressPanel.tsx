'use client'

import { useState, useEffect, useCallback } from 'react'
import { ProgressSteps } from './ProgressSteps'
import { GeneratedFilesView } from './GeneratedFilesView'
import { CommitToRepoForm } from './CommitToRepoForm'
import {
  getDeploymentWorkflowProgress,
  getGeneratedFiles,
  getRepoBranches,
  commitGeneratedFiles,
  syncDeploymentStatusFromWorkflow,
  skipCommitAndComplete,
} from '@/app/actions/deployments'
import { useRouter } from 'next/navigation'
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
  generatedFiles?: Array<{ path: string; content: string }>
}

export function DeploymentProgressPanel({
  deployment,
  isExpanded,
  onRetry,
}: DeploymentProgressPanelProps) {
  const router = useRouter()
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<Array<{ path: string; content: string }>>([])
  const [branches, setBranches] = useState<string[]>(['main'])
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [hasSynced, setHasSynced] = useState(false)

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
          generatedFiles: result.generatedFiles,
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

    fetchProgress()
    const interval = setInterval(fetchProgress, 2000)

    return () => {
      clearInterval(interval)
    }
  }, [isExpanded, workflowId, status, fetchProgress])

  // Sync deployment status when workflow completes
  useEffect(() => {
    if (!progress || hasSynced) return
    if (progress.status !== 'completed' && progress.status !== 'failed') return

    // Workflow finished but Payload status may not be updated
    // (Temporal worker has nil PayloadDeploymentClient)
    const syncStatus = async () => {
      setHasSynced(true)
      try {
        await syncDeploymentStatusFromWorkflow(
          deployment.id,
          progress.status,
          progress.status === 'failed' ? progress.message : undefined,
          progress.generatedFiles
        )
        // Refresh to get updated deployment status
        router.refresh()
      } catch (err) {
        console.error('Failed to sync deployment status:', err)
      }
    }
    syncStatus()
  }, [progress, hasSynced, deployment.id, router])

  useEffect(() => {
    if (status === 'generated' && isExpanded) {
      getGeneratedFiles(deployment.id).then((result) => {
        if (result.success) {
          setFiles(result.files)
        }
      })

      const appId = typeof deployment.app === 'string' ? deployment.app : deployment.app?.id
      if (appId) {
        getRepoBranches(appId).then((result) => {
          if (result.success) {
            setBranches(result.branches)
            if (result.defaultBranch) {
              setDefaultBranch(result.defaultBranch)
            }
          }
        })
      }
    }
  }, [status, isExpanded, deployment.id, deployment.app])

  const handleCommit = async (data: { branch: string; newBranch?: string; message: string }) => {
    const result = await commitGeneratedFiles({
      deploymentId: deployment.id,
      ...data,
    })
    if (!result.success) {
      throw new Error(result.error)
    }
  }

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
      <div className="p-4 space-y-4">
        <div className="rounded-md bg-purple-50 p-4">
          <p className="font-medium text-purple-800">Files Generated</p>
          <p className="text-sm text-purple-700 mt-1">
            Deployment files have been generated. Review and commit below.
          </p>
        </div>

        <GeneratedFilesView files={files} />

        <CommitToRepoForm
          deploymentId={deployment.id}
          branches={branches}
          defaultBranch={defaultBranch}
          onCommit={handleCommit}
          onSkip={async () => {
            const result = await skipCommitAndComplete(deployment.id)
            if (!result.success) {
              throw new Error(result.error)
            }
            router.refresh()
          }}
        />
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
