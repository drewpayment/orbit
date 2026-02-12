'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, MinusCircle, ExternalLink } from 'lucide-react'
import { RetryProvisioningButton } from './RetryProvisioningButton'
import { ProvisioningStatusBadge } from './ProvisioningStatusBadge'
import type { ApplicationWithProvisioningIssue } from '@/app/actions/kafka-applications'

interface ProvisioningErrorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applications: ApplicationWithProvisioningIssue[]
  onRetryComplete: () => void
}

type EnvStatus = 'success' | 'failed' | 'skipped'

function getEnvIcon(status: EnvStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />
    case 'skipped':
      return <MinusCircle className="h-4 w-4 text-gray-400" />
  }
}

function getEnvStatusText(env: string, details: ApplicationWithProvisioningIssue['provisioningDetails']) {
  if (!details) return { status: 'skipped' as EnvStatus, message: 'Not attempted' }
  
  const envDetails = details[env as keyof typeof details]
  if (!envDetails) return { status: 'skipped' as EnvStatus, message: 'Not configured' }

  if (envDetails.status === 'success') {
    return { status: 'success' as EnvStatus, message: 'Provisioned successfully' }
  }
  if (envDetails.status === 'failed') {
    const briefError = envDetails.error?.split('\n')[0] || 'Unknown error'
    return { status: 'failed' as EnvStatus, message: briefError }
  }
  return { status: 'skipped' as EnvStatus, message: envDetails.message || 'Skipped' }
}

export function ProvisioningErrorModal({
  open,
  onOpenChange,
  applications,
  onRetryComplete,
}: ProvisioningErrorModalProps) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  const handleRetryComplete = useCallback((appId: string) => {
    setRetryingIds((prev) => {
      const next = new Set(prev)
      next.delete(appId)
      return next
    })
    onRetryComplete()
  }, [onRetryComplete])

  const environments = ['dev', 'stage', 'prod']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Provisioning Issues</DialogTitle>
          <DialogDescription>
            {applications.length} application{applications.length !== 1 ? 's' : ''} with provisioning issues
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto">
          {applications.map((app) => (
            <div key={app.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{app.name}</h4>
                  <p className="text-sm text-muted-foreground">{app.workspaceSlug}</p>
                </div>
                <ProvisioningStatusBadge status={app.provisioningStatus} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Environment Status:</p>
                {environments.map((env) => {
                  const { status, message } = getEnvStatusText(env, app.provisioningDetails)
                  return (
                    <div key={env} className="flex items-start gap-2 text-sm">
                      {getEnvIcon(status)}
                      <span className="font-medium w-12">{env}</span>
                      <span className={status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}>
                        {message}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <RetryProvisioningButton
                  applicationId={app.id}
                  onRetryComplete={() => handleRetryComplete(app.id)}
                  disabled={app.provisioningStatus === 'in_progress' || retryingIds.has(app.id)}
                  size="sm"
                />
                <Button variant="outline" size="sm" asChild>
                  <a href="mailto:platform-team@example.com?subject=Kafka Provisioning Issue">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Contact Support
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
