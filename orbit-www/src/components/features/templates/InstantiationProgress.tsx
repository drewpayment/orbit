'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ExternalLink,
  AlertCircle,
  PartyPopper
} from 'lucide-react'
import Link from 'next/link'
import { getInstantiationProgress } from '@/app/actions/templates'

interface InstantiationProgressProps {
  workflowId: string
  templateName: string
}

interface ProgressData {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: string
  progressPercent: number
  errorMessage?: string
  resultRepoUrl?: string
  resultRepoName?: string
}

const STEPS = [
  { id: 'validating', label: 'Validating inputs' },
  { id: 'creating_repository', label: 'Creating repository' },
  { id: 'cloning_template', label: 'Cloning template' },
  { id: 'applying_variables', label: 'Applying variables' },
  { id: 'pushing_to_github', label: 'Pushing to GitHub' },
  { id: 'finalizing', label: 'Finalizing' },
  { id: 'completed', label: 'Completed' },
]

function getStepStatus(stepId: string, currentStep: string, status: string) {
  if (status === 'failed') {
    const currentIndex = STEPS.findIndex(s => s.id === currentStep)
    const stepIndex = STEPS.findIndex(s => s.id === stepId)
    if (stepIndex === currentIndex) return 'failed'
    if (stepIndex < currentIndex) return 'completed'
    return 'pending'
  }

  if (status === 'completed') return 'completed'

  const currentIndex = STEPS.findIndex(s => s.id === currentStep)
  const stepIndex = STEPS.findIndex(s => s.id === stepId)

  if (stepIndex < currentIndex) return 'completed'
  if (stepIndex === currentIndex) return 'running'
  return 'pending'
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case 'running':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />
    default:
      return <Circle className="h-5 w-5 text-gray-300" />
  }
}

export function InstantiationProgress({ workflowId, templateName }: InstantiationProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    if (!polling) return

    const fetchProgress = async () => {
      try {
        const result = await getInstantiationProgress(workflowId)
        if (result.error) {
          setError(result.error)
          setPolling(false)
          return
        }

        setProgress(result.progress || null)

        // Stop polling if completed or failed
        if (result.progress?.status === 'completed' || result.progress?.status === 'failed') {
          setPolling(false)
        }
      } catch (err) {
        console.error('Failed to fetch progress:', err)
      }
    }

    fetchProgress()
    const interval = setInterval(fetchProgress, 2000)
    return () => clearInterval(interval)
  }, [workflowId, polling])

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
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const isCompleted = progress.status === 'completed'
  const isFailed = progress.status === 'failed'

  return (
    <div className="space-y-6">
      {isCompleted && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <PartyPopper className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-700 dark:text-green-300">
            Repository Created Successfully!
          </AlertTitle>
          <AlertDescription className="text-green-600 dark:text-green-400">
            Your new repository is ready at{' '}
            <a
              href={progress.resultRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              {progress.resultRepoName}
            </a>
          </AlertDescription>
        </Alert>
      )}

      {isFailed && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Instantiation Failed</AlertTitle>
          <AlertDescription>{progress.errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Creating from {templateName}</CardTitle>
          <CardDescription>
            {isCompleted ? 'Repository creation complete' :
             isFailed ? 'Repository creation failed' :
             'Please wait while we set up your new repository...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {STEPS.map((step) => {
              const stepStatus = getStepStatus(step.id, progress.currentStep, progress.status)
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 ${
                    stepStatus === 'pending' ? 'text-muted-foreground' : ''
                  }`}
                >
                  <StepIcon status={stepStatus} />
                  <span className={stepStatus === 'running' ? 'font-medium' : ''}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-6">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isFailed ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              {progress.progressPercent}% complete
            </p>
          </div>
        </CardContent>
      </Card>

      {isCompleted && progress.resultRepoUrl && (
        <div className="flex justify-center gap-4">
          <Button asChild>
            <a href={progress.resultRepoUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Repository
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/templates">
              Back to Templates
            </Link>
          </Button>
        </div>
      )}

      {isFailed && (
        <div className="flex justify-center">
          <Button variant="outline" asChild>
            <Link href="/templates">
              Back to Templates
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
