'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { RefreshCw, ChevronDown, CheckCircle2, XCircle, MinusCircle, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  listApplicationsWithProvisioningIssues,
  retryVirtualClusterProvisioning,
  type ApplicationWithProvisioningIssue,
} from '@/app/actions/kafka-applications'
import { ProvisioningStatusBadge } from '@/components/features/kafka'

type StatusFilter = 'all' | 'failed' | 'partial' | 'in_progress' | 'pending'

export function ProvisioningTab() {
  const [applications, setApplications] = useState<ApplicationWithProvisioningIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listApplicationsWithProvisioningIssues()
      if (result.success && result.applications) {
        setApplications(result.applications)
      } else {
        toast.error(result.error || 'Failed to load applications')
      }
    } catch (error) {
      toast.error('Failed to load applications')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApplications()
  }, [loadApplications])

  const handleRetry = useCallback(async (appId: string) => {
    setRetryingIds((prev) => new Set(prev).add(appId))
    toast.success('Provisioning started')

    try {
      const result = await retryVirtualClusterProvisioning(appId)
      if (result.success) {
        toast.success('Provisioning workflow started')
        loadApplications()
      } else {
        toast.error(`Failed: ${result.error}`)
      }
    } catch (error) {
      toast.error('Failed to start provisioning')
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(appId)
        return next
      })
    }
  }, [loadApplications])

  const copyWorkflowId = useCallback((workflowId: string) => {
    navigator.clipboard.writeText(workflowId)
    setCopiedId(workflowId)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const filteredApplications = applications.filter((app) => {
    if (filter === 'all') return true
    return app.provisioningStatus === filter
  })

  const environments = ['dev', 'stage', 'prod']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {filteredApplications.length} of {applications.length} application
            {applications.length !== 1 ? 's' : ''}
          </p>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={loadApplications} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {filteredApplications.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Clear</h3>
            <p className="text-muted-foreground text-center">
              No applications with provisioning issues.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {filteredApplications.map((app) => (
          <Card key={app.id}>
            <Collapsible
              open={expandedIds.has(app.id)}
              onOpenChange={() => toggleExpanded(app.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="p-0 h-auto">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedIds.has(app.id) ? 'rotate-180' : ''
                          }`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <div>
                      <CardTitle className="text-base">{app.name}</CardTitle>
                      <CardDescription>{app.workspaceSlug}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ProvisioningStatusBadge status={app.provisioningStatus} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRetry(app.id)}
                      disabled={app.provisioningStatus === 'in_progress' || retryingIds.has(app.id)}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${retryingIds.has(app.id) ? 'animate-spin' : ''}`}
                      />
                      Retry
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CollapsibleContent>
                <CardContent className="pt-0 space-y-4">
                  {app.provisioningWorkflowId && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Workflow:</span>
                      <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
                        {app.provisioningWorkflowId}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => copyWorkflowId(app.provisioningWorkflowId!)}
                      >
                        {copiedId === app.provisioningWorkflowId ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Environment Status:</p>
                    {environments.map((env) => {
                      const details = app.provisioningDetails?.[env as keyof typeof app.provisioningDetails]
                      let icon = <MinusCircle className="h-4 w-4 text-gray-400" />
                      let statusText = 'Not configured'
                      let errorText: string | null = null

                      if (details) {
                        if (details.status === 'success') {
                          icon = <CheckCircle2 className="h-4 w-4 text-green-600" />
                          statusText = 'OK'
                        } else if (details.status === 'failed') {
                          icon = <XCircle className="h-4 w-4 text-red-600" />
                          statusText = 'Failed'
                          errorText = details.error || 'Unknown error'
                        } else if (details.status === 'skipped') {
                          statusText = details.message || 'Skipped'
                        }
                      }

                      return (
                        <div key={env} className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            {icon}
                            <span className="font-medium w-12 uppercase">{env}</span>
                            <span className={details?.status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}>
                              {statusText}
                            </span>
                          </div>
                          {errorText && (
                            <pre className="ml-6 text-xs bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                              {errorText}
                            </pre>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {app.provisioningError && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-red-600">Error:</p>
                      <pre className="text-xs bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                        {app.provisioningError}
                      </pre>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(app.updatedAt).toLocaleString()}
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>
    </div>
  )
}
