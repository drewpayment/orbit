'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, RefreshCw, AlertCircle, CheckCircle2, Package } from 'lucide-react'
import { startBuild, getBuildStatus } from '@/app/actions/builds'
import { formatDistanceToNow } from 'date-fns'

interface BuildSectionProps {
  appId: string
  appName: string
  hasRepository: boolean
  hasRegistryConfig: boolean
}

type BuildStatus = 'none' | 'analyzing' | 'building' | 'success' | 'failed'

interface BuildInfo {
  status: BuildStatus
  imageUrl?: string
  imageDigest?: string
  imageTag?: string
  builtAt?: string
  workflowId?: string
  error?: string
  buildConfig?: {
    language?: string
    languageVersion?: string
    framework?: string
    buildCommand?: string
    startCommand?: string
  }
}

export function BuildSection({ appId, appName, hasRepository, hasRegistryConfig }: BuildSectionProps) {
  const router = useRouter()
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial build status
  useEffect(() => {
    async function fetchStatus() {
      const status = await getBuildStatus(appId)
      setBuildInfo(status)
      setIsLoading(false)
    }
    fetchStatus()
  }, [appId])

  // Poll for status while building
  useEffect(() => {
    if (buildInfo?.status === 'analyzing' || buildInfo?.status === 'building') {
      const interval = setInterval(async () => {
        const status = await getBuildStatus(appId)
        setBuildInfo(status)
        if (status?.status === 'success' || status?.status === 'failed') {
          router.refresh()
        }
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [appId, buildInfo?.status, router])

  const handleStartBuild = async () => {
    setIsStarting(true)
    setError(null)

    const result = await startBuild({ appId })

    if (result.success) {
      setBuildInfo(prev => ({
        ...prev,
        status: 'analyzing',
        workflowId: result.workflowId,
      }))
    } else {
      setError(result.error || 'Failed to start build')
    }

    setIsStarting(false)
  }

  const getStatusBadge = (status: BuildStatus) => {
    switch (status) {
      case 'none':
        return <Badge variant="secondary">Never Built</Badge>
      case 'analyzing':
        return <Badge variant="default" className="bg-blue-500">Analyzing...</Badge>
      case 'building':
        return <Badge variant="default" className="bg-blue-500">Building...</Badge>
      case 'success':
        return <Badge variant="default" className="bg-green-500">Success</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // No repository configured
  if (!hasRepository) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Configure a repository to enable builds</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  // No registry configured
  if (!hasRegistryConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Configure a container registry to enable builds</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push('/settings/registries')}>
              Configure Registry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isBuilding = buildInfo?.status === 'analyzing' || buildInfo?.status === 'building'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Container Image
          </CardTitle>
          <CardDescription>
            Build container images from your source code using Railpack
          </CardDescription>
        </div>
        <Button
          onClick={handleStartBuild}
          disabled={isStarting || isBuilding}
          size="sm"
        >
          {isStarting || isBuilding ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {buildInfo?.status === 'analyzing' ? 'Analyzing...' : 'Building...'}
            </>
          ) : buildInfo?.status === 'success' ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Rebuild
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Build Now
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Status Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Status</div>
            <div className="flex items-center gap-2">
              {getStatusBadge(buildInfo?.status || 'none')}
            </div>
          </div>

          {/* Latest Build Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Latest Build</div>
            {buildInfo?.imageUrl ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <code className="text-xs truncate max-w-[200px]">
                    {buildInfo.imageUrl}
                  </code>
                </div>
                {buildInfo.builtAt && (
                  <div className="text-xs text-muted-foreground">
                    Built {formatDistanceToNow(new Date(buildInfo.builtAt), { addSuffix: true })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No builds yet</div>
            )}
          </div>

          {/* Build Config Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Build Config</div>
            {buildInfo?.buildConfig?.language ? (
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Language: </span>
                  {buildInfo.buildConfig.language}
                  {buildInfo.buildConfig.languageVersion && ` ${buildInfo.buildConfig.languageVersion}`}
                </div>
                {buildInfo.buildConfig.framework && (
                  <div>
                    <span className="text-muted-foreground">Framework: </span>
                    {buildInfo.buildConfig.framework}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Auto-detect on build</div>
            )}
          </div>
        </div>

        {/* Error details */}
        {buildInfo?.status === 'failed' && buildInfo.error && (
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div>
                <div className="font-medium text-destructive">Build Failed</div>
                <div className="text-sm text-muted-foreground mt-1">{buildInfo.error}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
