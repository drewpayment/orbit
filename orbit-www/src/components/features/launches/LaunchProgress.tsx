'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { getLaunchWorkflowProgress } from '@/app/actions/launches'
import { cn } from '@/lib/utils'

interface LaunchProgressProps {
  workflowId: string
  launchName: string
  initialStatus?: string
}

interface ProgressStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  completedAt?: string
  error?: string
}

interface ProgressData {
  status: string
  currentStep: number
  totalSteps: number
  message: string
  percentage: number
  logs: string[]
  steps?: ProgressStep[]
}

export function LaunchProgress({ workflowId, launchName, initialStatus }: LaunchProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(true)

  useEffect(() => {
    let mounted = true
    let timeoutId: NodeJS.Timeout

    const pollStatus = async () => {
      try {
        const result = await getLaunchWorkflowProgress(workflowId)
        if (!mounted) return

        if (result.success) {
          setProgress({
            status: result.status || '',
            currentStep: result.currentStep || 0,
            totalSteps: result.totalSteps || 0,
            message: result.message || '',
            percentage: result.percentage || 0,
            logs: result.logs || [],
          })

          // Stop polling when terminal state reached
          const terminalStates = ['completed', 'failed', 'active', 'deorbited', 'aborted', 'cancelled']
          if (terminalStates.includes(result.status || '')) {
            setIsPolling(false)
            return
          }
        } else {
          setError(result.error || 'Failed to fetch workflow progress')
          setIsPolling(false)
          return
        }
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'An error occurred')
        setIsPolling(false)
        return
      }

      // Poll every 2 seconds
      if (mounted && isPolling) {
        timeoutId = setTimeout(pollStatus, 2000)
      }
    }

    pollStatus()

    return () => {
      mounted = false
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [workflowId, isPolling])

  const getStepIcon = (stepIndex: number) => {
    if (!progress) return <Circle className="h-5 w-5 text-gray-300" />

    if (stepIndex < progress.currentStep) {
      return <CheckCircle2 className="h-5 w-5 text-green-600" />
    }
    if (stepIndex === progress.currentStep && progress.status !== 'failed') {
      return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
    }
    if (stepIndex === progress.currentStep && progress.status === 'failed') {
      return <XCircle className="h-5 w-5 text-red-600" />
    }
    return <Circle className="h-5 w-5 text-gray-300" />
  }

  const getStepBackground = (stepIndex: number) => {
    if (!progress) return ''

    if (stepIndex < progress.currentStep) {
      return 'bg-green-50 dark:bg-green-950'
    }
    if (stepIndex === progress.currentStep && progress.status !== 'failed') {
      return 'bg-blue-50 dark:bg-blue-950'
    }
    if (stepIndex === progress.currentStep && progress.status === 'failed') {
      return 'bg-red-50 dark:bg-red-950'
    }
    return ''
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!progress) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // Build synthetic steps from progress data
  const defaultStepNames = [
    'Validate Configuration',
    'Provision Cloud Resources',
    'Configure Infrastructure',
    'Verify Deployment',
    'Finalize',
  ]
  const stepCount = progress.totalSteps > 0 ? progress.totalSteps : defaultStepNames.length
  const stepNames = progress.totalSteps > 0
    ? Array.from({ length: progress.totalSteps }, (_, i) => defaultStepNames[i] || `Step ${i + 1}`)
    : defaultStepNames

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Launch In Progress</CardTitle>
              <CardDescription>Deploying: {launchName}</CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{progress.percentage}%</div>
              <div className="text-sm text-muted-foreground capitalize">{progress.status}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress Bar */}
          <div className="w-full bg-secondary rounded-full h-2 mb-4">
            <div
              className={cn(
                'h-2 rounded-full transition-all duration-500',
                progress.status === 'failed' ? 'bg-red-500' : 'bg-green-500'
              )}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          {progress.message && (
            <p className="text-sm text-muted-foreground">{progress.message}</p>
          )}
        </CardContent>
      </Card>

      {/* Steps Card */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stepNames.slice(0, stepCount).map((stepName, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-center gap-4 p-3 rounded-lg',
                  getStepBackground(index),
                )}
              >
                {getStepIcon(index)}
                <div className="flex-1">
                  <div className="font-medium">{stepName}</div>
                  {index === progress.currentStep && progress.status !== 'failed' && (
                    <div className="text-sm text-muted-foreground">In progress...</div>
                  )}
                  {index === progress.currentStep && progress.status === 'failed' && (
                    <div className="text-sm text-red-600">Failed</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Logs */}
      {progress.logs && progress.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
              {progress.logs.map((line, i) => (
                <div key={i} className="text-muted-foreground">{line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Terminal states */}
      {progress.status === 'active' && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">Launch Successful</AlertTitle>
          <AlertDescription>
            All resources have been provisioned successfully.
          </AlertDescription>
        </Alert>
      )}

      {progress.status === 'failed' && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Launch Failed</AlertTitle>
          <AlertDescription>
            {progress.message || 'An unexpected error occurred during deployment.'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
