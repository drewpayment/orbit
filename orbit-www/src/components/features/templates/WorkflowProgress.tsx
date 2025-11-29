'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ExternalLink,
  ArrowRight,
  AlertCircle,
  Plus
} from 'lucide-react'
import { getWorkflowStatus, type WorkflowStatus, type WorkflowStep } from '@/app/actions/workflows'
import { createAppFromTemplate } from '@/app/actions/apps'
import { cn } from '@/lib/utils'

interface WorkflowProgressProps {
  workflowId: string
  templateName: string
  templateId?: string
  workspaceId?: string
  installationId?: string
}

export function WorkflowProgress({ workflowId, templateName, templateId, workspaceId, installationId }: WorkflowProgressProps) {
  const router = useRouter()
  const [status, setStatus] = useState<WorkflowStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(true)
  const [isCreatingApp, setIsCreatingApp] = useState(false)
  const [appCreated, setAppCreated] = useState(false)
  const [appCreateError, setAppCreateError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let timeoutId: NodeJS.Timeout

    const pollStatus = async () => {
      try {
        const result = await getWorkflowStatus(workflowId)
        if (!mounted) return

        if (result) {
          setStatus(result)

          // Stop polling if completed or failed
          if (result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
            setIsPolling(false)
            return
          }
        } else {
          setError('Failed to fetch workflow status')
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

  const getStepIcon = (step: WorkflowStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return <Circle className="h-5 w-5 text-gray-300" />
    }
  }

  const getProgressPercentage = () => {
    if (!status) return 0
    const completed = status.steps.filter(s => s.status === 'completed').length
    return Math.round((completed / status.steps.length) * 100)
  }

  const handleAddToCatalog = async () => {
    if (!status?.result?.gitUrl || !templateId || !workspaceId) return

    setIsCreatingApp(true)
    setAppCreateError(null)
    try {
      // Extract owner/repo from gitUrl
      const match = status.result.gitUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
      if (!match) throw new Error('Invalid repository URL')

      const [, owner, repo] = match
      const repoName = repo.replace(/\.git$/, '')

      const result = await createAppFromTemplate({
        name: status.result.repositoryId || repoName,
        repositoryOwner: owner,
        repositoryName: repoName,
        repositoryUrl: status.result.gitUrl,
        templateId: templateId,
        workspaceId: workspaceId,
        installationId: installationId,
      })

      if (result.success) {
        setAppCreated(true)
        router.push(`/apps/${result.appId}`)
      } else {
        setAppCreateError(result.error || 'Failed to create app')
      }
    } catch (error) {
      console.error('Failed to create app:', error)
      setAppCreateError(error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setIsCreatingApp(false)
    }
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

  if (!status) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Creating Repository</CardTitle>
              <CardDescription>From template: {templateName}</CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{getProgressPercentage()}%</div>
              <div className="text-sm text-muted-foreground capitalize">{status.status}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress Bar */}
          <div className="w-full bg-secondary rounded-full h-2 mb-4">
            <div
              className={cn(
                "h-2 rounded-full transition-all duration-500",
                status.status === 'failed' ? 'bg-red-500' : 'bg-green-500'
              )}
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Steps Card */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {status.steps.map((step, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg",
                  step.status === 'running' && 'bg-blue-50 dark:bg-blue-950',
                  step.status === 'completed' && 'bg-green-50 dark:bg-green-950',
                  step.status === 'failed' && 'bg-red-50 dark:bg-red-950',
                )}
              >
                {getStepIcon(step)}
                <div className="flex-1">
                  <div className="font-medium">{step.name}</div>
                  {step.status === 'running' && (
                    <div className="text-sm text-muted-foreground">In progress...</div>
                  )}
                  {step.completedAt && (
                    <div className="text-xs text-muted-foreground">
                      Completed at {new Date(step.completedAt).toLocaleTimeString()}
                    </div>
                  )}
                  {step.error && (
                    <div className="text-sm text-red-600">{step.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Success Result */}
      {status.status === 'completed' && status.result && !appCreated && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">Repository Created Successfully!</AlertTitle>
          <AlertDescription>
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-4">
                {status.result.gitUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={status.result.gitUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View on GitHub
                    </a>
                  </Button>
                )}
                <Button size="sm" onClick={() => router.push('/repositories')}>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Go to Repositories
                </Button>
              </div>
              {templateId && workspaceId && (
                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    Ready to deploy? Add this app to your catalog and set up deployments.
                  </p>
                  {appCreateError && (
                    <Alert variant="destructive" className="mb-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>{appCreateError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/templates')}
                    >
                      Skip for now
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddToCatalog}
                      disabled={isCreatingApp}
                    >
                      {isCreatingApp ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add to Catalog
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Failed State */}
      {status.status === 'failed' && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Repository Creation Failed</AlertTitle>
          <AlertDescription>
            <p>{status.error || 'An unexpected error occurred. Please try again.'}</p>
            <div className="flex gap-4 mt-4">
              <Button variant="outline" size="sm" onClick={() => router.back()}>
                Go Back
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
