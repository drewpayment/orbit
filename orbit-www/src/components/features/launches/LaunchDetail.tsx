'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Circle,
  Cloud,
  Loader2,
  Rocket,
  XCircle,
  CheckCircle2,
  Shield,
  AlertTriangle,
} from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { LaunchStatusBadge, type LaunchStatus } from './LaunchStatusBadge'
import { LaunchProgress } from './LaunchProgress'
import { DeorbitConfirmation } from './DeorbitConfirmation'
import { abortLaunchAction, approveLaunchAction } from '@/app/actions/launches'
import { toast } from 'sonner'

interface LaunchDoc {
  id: string
  name: string
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean'
  region: string
  status: string
  template?: { id: string; name?: string; slug?: string } | string
  workspace?: { id: string; name?: string } | string
  cloudAccount?: { id: string; name?: string; provider?: string } | string
  app?: { id: string; name?: string } | string
  workflowId?: string | null
  pulumiStackName?: string | null
  pulumiOutputs?: Record<string, unknown> | null
  parameters?: Record<string, unknown> | null
  approvalConfig?: {
    required?: boolean
    approvers?: Array<{ id: string; name?: string; email?: string } | string>
    timeoutHours?: number
  }
  approvedBy?: { id: string; name?: string; email?: string } | string
  launchedBy?: { id: string; name?: string; email?: string } | string
  launchError?: string | null
  lastLaunchedAt?: string | null
  lastDeorbitedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface LaunchDetailProps {
  launch: LaunchDoc
  currentUserId: string
}

const providerLabels: Record<string, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
}

function resolveRelationship<T extends { id: string }>(
  rel: T | string | undefined | null,
): T | null {
  if (!rel) return null
  if (typeof rel === 'string') return null
  return rel
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

function getUserDisplay(
  user: { id: string; name?: string; email?: string } | string | undefined | null,
): string {
  if (!user) return '-'
  if (typeof user === 'string') return user
  return user.name || user.email || user.id
}

export function LaunchDetail({ launch, currentUserId }: LaunchDetailProps) {
  const router = useRouter()
  const [deorbitOpen, setDeorbitOpen] = useState(false)
  const [isAborting, setIsAborting] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)

  const status = launch.status as LaunchStatus
  const template = resolveRelationship(launch.template as any)
  const cloudAccount = resolveRelationship(launch.cloudAccount as any)
  const app = resolveRelationship(launch.app as any)

  const isInProgress = ['launching', 'pending', 'deorbiting'].includes(status)
  const defaultTab = isInProgress ? 'progress' : 'overview'

  // Check if the current user is an approver
  const isApprover = launch.approvalConfig?.approvers?.some((approver) => {
    if (typeof approver === 'string') return approver === currentUserId
    return approver.id === currentUserId
  }) ?? false

  async function handleAbort() {
    if (!launch.workflowId) {
      toast.error('No workflow ID found for this launch')
      return
    }

    setIsAborting(true)
    try {
      const result = await abortLaunchAction(launch.workflowId)
      if (result.success) {
        toast.success(`Abort initiated for "${launch.name}"`)
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to abort launch')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to abort launch')
    } finally {
      setIsAborting(false)
    }
  }

  async function handleApprove() {
    if (!launch.workflowId) {
      toast.error('No workflow ID found for this launch')
      return
    }

    setIsApproving(true)
    try {
      const result = await approveLaunchAction(launch.workflowId, true)
      if (result.success) {
        toast.success('Launch approved')
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to approve launch')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve launch')
    } finally {
      setIsApproving(false)
    }
  }

  async function handleReject() {
    if (!launch.workflowId) {
      toast.error('No workflow ID found for this launch')
      return
    }

    setIsRejecting(true)
    try {
      const result = await approveLaunchAction(launch.workflowId, false, 'Rejected by user')
      if (result.success) {
        toast.success('Launch rejected')
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to reject launch')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject launch')
    } finally {
      setIsRejecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/launches">Launches</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{launch.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{launch.name}</h1>
            <LaunchStatusBadge status={launch.status} />
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Cloud className="h-4 w-4" />
              {providerLabels[launch.provider] ?? launch.provider}
            </span>
            <span className="font-mono">{launch.region}</span>
            {template && (
              <span>{template.name || template.slug}</span>
            )}
            {app && (
              <Link href={`/apps/${app.id}`} className="hover:underline">
                App: {app.name || app.id}
              </Link>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {status === 'active' && (
            <Button
              variant="destructive"
              onClick={() => setDeorbitOpen(true)}
            >
              <Rocket className="mr-2 h-4 w-4" />
              Deorbit
            </Button>
          )}

          {(status === 'launching' || status === 'awaiting_approval') && (
            <Button
              variant="destructive"
              onClick={handleAbort}
              disabled={isAborting}
            >
              {isAborting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aborting...
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Abort
                </>
              )}
            </Button>
          )}

          {status === 'awaiting_approval' && isApprover && (
            <>
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={isRejecting}
              >
                {isRejecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isApproving}
              >
                {isApproving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {launch.launchError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Launch Error</AlertTitle>
          <AlertDescription>{launch.launchError}</AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column — Outputs & Parameters (2/3 width) */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Outputs</CardTitle>
                </CardHeader>
                <CardContent>
                  {launch.pulumiOutputs && Object.keys(launch.pulumiOutputs).length > 0 ? (
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                      {Object.entries(launch.pulumiOutputs).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm font-medium text-muted-foreground">{key}</dt>
                          <dd className="mt-1 font-mono text-sm break-all">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">No outputs available yet.</p>
                  )}
                </CardContent>
              </Card>

              {launch.parameters && Object.keys(launch.parameters).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Parameters</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                      {Object.entries(launch.parameters).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm font-medium text-muted-foreground">{key}</dt>
                          <dd className="mt-1 font-mono text-sm">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right column — Details card (1/3 width) */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Provider</dt>
                      <dd className="mt-1">{providerLabels[launch.provider] ?? launch.provider}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Region</dt>
                      <dd className="mt-1 font-mono">{launch.region}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Template</dt>
                      <dd className="mt-1">{template?.name || template?.slug || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Cloud Account</dt>
                      <dd className="mt-1">{cloudAccount?.name || '-'}</dd>
                    </div>
                    {launch.pulumiStackName && (
                      <div>
                        <dt className="text-sm font-medium text-muted-foreground">Pulumi Stack</dt>
                        <dd className="mt-1 font-mono">{launch.pulumiStackName}</dd>
                      </div>
                    )}
                    {app && (
                      <div>
                        <dt className="text-sm font-medium text-muted-foreground">Linked App</dt>
                        <dd className="mt-1">
                          <Link href={`/apps/${app.id}`} className="text-primary hover:underline">
                            {app.name || app.id}
                          </Link>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Launched By</dt>
                      <dd className="mt-1">{getUserDisplay(launch.launchedBy)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Created</dt>
                      <dd className="mt-1">{formatDate(launch.createdAt)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {launch.approvalConfig?.required && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      Approval
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-4">
                      <div>
                        <dt className="text-sm font-medium text-muted-foreground">Timeout</dt>
                        <dd className="mt-1">{launch.approvalConfig.timeoutHours || 24} hours</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-muted-foreground">Approvers</dt>
                        <dd className="mt-1">
                          {launch.approvalConfig.approvers?.map((a) =>
                            getUserDisplay(a as any)
                          ).join(', ') || '-'}
                        </dd>
                      </div>
                      {launch.approvedBy && (
                        <div>
                          <dt className="text-sm font-medium text-muted-foreground">Approved By</dt>
                          <dd className="mt-1">{getUserDisplay(launch.approvedBy)}</dd>
                        </div>
                      )}
                    </dl>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress">
          {launch.workflowId ? (
            <LaunchProgress
              workflowId={launch.workflowId}
              launchName={launch.name}
              initialStatus={launch.status}
            />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                No workflow has been started for this launch yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Resources Tab */}
        <TabsContent value="resources">
          <Card>
            <CardHeader>
              <CardTitle>Provisioned Resources</CardTitle>
            </CardHeader>
            <CardContent className="py-16 text-center text-muted-foreground">
              {status === 'active'
                ? 'Resource inventory will be available in a future update.'
                : 'Resources will appear here once the launch is active.'}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Created */}
                <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                  <div className="mt-0.5">
                    <Rocket className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">Launch Created</div>
                    <div className="text-sm text-muted-foreground">
                      By {getUserDisplay(launch.launchedBy)} on {formatDate(launch.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Launched */}
                {launch.lastLaunchedAt && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                    <div className="mt-0.5">
                      <Cloud className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Workflow Started</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(launch.lastLaunchedAt)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Approved */}
                {launch.approvedBy && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-green-50 dark:bg-green-950">
                    <div className="mt-0.5">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Approved</div>
                      <div className="text-sm text-muted-foreground">
                        By {getUserDisplay(launch.approvedBy)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Current Status */}
                {status === 'active' && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-green-50 dark:bg-green-950">
                    <div className="mt-0.5">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Active</div>
                      <div className="text-sm text-muted-foreground">
                        All resources provisioned successfully
                      </div>
                    </div>
                  </div>
                )}

                {status === 'failed' && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-red-50 dark:bg-red-950">
                    <div className="mt-0.5">
                      <XCircle className="h-5 w-5 text-red-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Failed</div>
                      <div className="text-sm text-muted-foreground">
                        {launch.launchError || 'An error occurred during deployment'}
                      </div>
                    </div>
                  </div>
                )}

                {status === 'deorbited' && launch.lastDeorbitedAt && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                    <div className="mt-0.5">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Deorbited</div>
                      <div className="text-sm text-muted-foreground">
                        Resources destroyed on {formatDate(launch.lastDeorbitedAt)}
                      </div>
                    </div>
                  </div>
                )}

                {status === 'aborted' && (
                  <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                    <div className="mt-0.5">
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Aborted</div>
                      <div className="text-sm text-muted-foreground">
                        Launch was aborted before completion
                      </div>
                    </div>
                  </div>
                )}

                {/* Last Updated */}
                <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/50">
                  <div className="mt-0.5">
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">Last Updated</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(launch.updatedAt)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Deorbit Confirmation Modal */}
      {launch.workflowId && (
        <DeorbitConfirmation
          open={deorbitOpen}
          onOpenChange={setDeorbitOpen}
          launchName={launch.name}
          workflowId={launch.workflowId}
          onDeorbitStarted={() => router.refresh()}
        />
      )}
    </div>
  )
}
