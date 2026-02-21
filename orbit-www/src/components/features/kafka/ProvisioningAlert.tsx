'use client'

import { useState, useEffect, useCallback } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { ProvisioningErrorModal } from './ProvisioningErrorModal'
import {
  listApplicationsWithProvisioningIssues,
  type ApplicationWithProvisioningIssue,
} from '@/app/actions/kafka-applications'

interface ProvisioningAlertProps {
  workspaceId: string
}

export function ProvisioningAlert({ workspaceId }: ProvisioningAlertProps) {
  const [applications, setApplications] = useState<ApplicationWithProvisioningIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const loadIssues = useCallback(async () => {
    try {
      const result = await listApplicationsWithProvisioningIssues(workspaceId)
      if (result.success && result.applications) {
        const issues = result.applications.filter(
          (app) => app.provisioningStatus === 'failed' || app.provisioningStatus === 'partial'
        )
        setApplications(issues)
      }
    } catch (error) {
      console.error('Failed to load provisioning issues:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadIssues()
  }, [loadIssues])

  const handleRetryComplete = useCallback(() => {
    loadIssues()
  }, [loadIssues])

  if (loading || applications.length === 0) {
    return null
  }

  const issueCount = applications.length
  const issueText = issueCount === 1 
    ? '1 application has provisioning issues'
    : `${issueCount} applications have provisioning issues`

  return (
    <>
      <Alert variant="destructive" className="mb-6 bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between w-full">
          <span>{issueText}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="ml-4"
          >
            View Details
          </Button>
        </AlertDescription>
      </Alert>

      <ProvisioningErrorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        applications={applications}
        onRetryComplete={handleRetryComplete}
      />
    </>
  )
}
