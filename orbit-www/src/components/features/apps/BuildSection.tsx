'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, RefreshCw, AlertCircle, CheckCircle2, Package, XCircle, Settings2, ExternalLink, Lightbulb } from 'lucide-react'
import { startBuild, getBuildStatus, checkRegistryAvailable, cancelBuild, selectPackageManager, type BuildStatus } from '@/app/actions/builds'
import { formatDistanceToNow } from 'date-fns'

// Parse build errors and provide actionable suggestions
function parseBuildError(error: string): { summary: string; details?: string; suggestions: string[] } {
  const suggestions: string[] = []
  let summary = 'Build failed'
  let details = error

  // Lockfile not found
  if (error.includes('Lockfile not found')) {
    summary = 'Missing package lockfile'
    details = 'The repository has a package.json but no lockfile (yarn.lock, package-lock.json, or pnpm-lock.yaml).'
    suggestions.push('Run "npm install" or "yarn" locally to generate a lockfile')
    suggestions.push('Commit the lockfile to your repository')
    suggestions.push('Push the changes and try building again')
  }
  // Git clone failed - authentication
  else if (error.includes('could not read Username') || error.includes('Authentication failed')) {
    summary = 'Repository access denied'
    details = 'Unable to clone the repository. The GitHub App may not have access.'
    suggestions.push('Verify the GitHub App is installed on the repository')
    suggestions.push('Check that the repository URL is correct')
    suggestions.push('Ensure the GitHub App has read access to the repository')
  }
  // Git clone failed - not found
  else if (error.includes('Repository not found') || error.includes('does not exist')) {
    summary = 'Repository not found'
    details = 'The repository could not be found. It may be private or the URL may be incorrect.'
    suggestions.push('Verify the repository URL is correct')
    suggestions.push('For private repos, ensure the GitHub App has access')
  }
  // Docker build failed - generic
  else if (error.includes('docker build failed')) {
    summary = 'Docker build failed'
    if (error.includes('COPY failed')) {
      suggestions.push('Check that all files referenced in the Dockerfile exist')
    }
    if (error.includes('npm ERR!') || error.includes('yarn error')) {
      suggestions.push('Check for dependency installation errors')
      suggestions.push('Verify your package.json is valid')
    }
    suggestions.push('Review your Dockerfile for errors')
    suggestions.push('Try building locally with "docker build ." to debug')
  }
  // No Dockerfile
  else if (error.includes('no Dockerfile found') || error.includes('Dockerfile not found')) {
    summary = 'No Dockerfile found'
    details = 'The repository does not contain a Dockerfile and Railpack could not auto-detect the build configuration.'
    suggestions.push('Add a Dockerfile to your repository')
    suggestions.push('Or ensure your project uses a supported framework for auto-detection')
  }
  // Registry auth failed
  else if (error.includes('registry login failed') || error.includes('unauthorized')) {
    summary = 'Registry authentication failed'
    details = 'Unable to authenticate with the container registry.'
    suggestions.push('Check your registry credentials in Settings > Registries')
    suggestions.push('Verify the GitHub App has packages:write permission for GHCR')
  }
  // Generic error
  else {
    suggestions.push('Check the build logs for more details')
    suggestions.push('Try building again - transient errors sometimes resolve themselves')
  }

  return { summary, details, suggestions }
}

interface PackageManagerPromptProps {
  choices: string[]
  workflowId: string
  onSelect: () => void
}

function PackageManagerPrompt({ choices, workflowId, onSelect }: PackageManagerPromptProps) {
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (pm: string) => {
    setSelecting(pm)
    setError(null)

    const result = await selectPackageManager(
      workflowId,
      pm as 'npm' | 'yarn' | 'pnpm' | 'bun'
    )

    if (result.success) {
      onSelect()
    } else {
      setError(result.error || 'Failed to select package manager')
      setSelecting(null)
    }
  }

  const pmIcons: Record<string, string> = {
    npm: '📦',
    yarn: '🧶',
    pnpm: '🚀',
    bun: '🥟',
  }

  return (
    <div className="p-4 border rounded-lg bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          Package manager not detected
        </span>
      </div>
      <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
        No lockfile or <code className="px-1 bg-amber-100 dark:bg-amber-900 rounded">packageManager</code> field
        found in your repository. Please select which package manager to use for this build:
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((pm) => (
          <button
            key={pm}
            onClick={() => handleSelect(pm)}
            disabled={selecting !== null}
            className={`
              px-4 py-2 rounded-md border font-medium transition-colors
              ${selecting === pm
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            <span className="mr-2">{pmIcons[pm] || '📦'}</span>
            {pm}
            {selecting === pm && (
              <span className="ml-2 inline-block animate-spin">⏳</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

interface BuildSectionProps {
  appId: string
  appName: string
  hasRepository: boolean
}

interface RegistryInfo {
  available: boolean
  registryName?: string
  registryType?: 'ghcr' | 'acr'
  isWorkspaceDefault?: boolean
}

export function BuildSection({ appId, hasRepository }: BuildSectionProps) {
  const router = useRouter()
  const [buildInfo, setBuildInfo] = useState<BuildStatus | null>(null)
  const [registryInfo, setRegistryInfo] = useState<RegistryInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial build status and registry availability
  useEffect(() => {
    async function fetchData() {
      const [status, registry] = await Promise.all([
        getBuildStatus(appId),
        checkRegistryAvailable(appId),
      ])
      setBuildInfo(status)
      setRegistryInfo(registry)
      setIsLoading(false)
    }
    fetchData()
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

  const handleCancelBuild = async () => {
    setIsCancelling(true)
    setError(null)

    const result = await cancelBuild(appId)

    if (result.success) {
      setBuildInfo(prev => ({
        ...prev,
        status: 'none',
        workflowId: undefined,
        error: undefined,
      }))
      router.refresh()
    } else {
      setError(result.error || 'Failed to cancel build')
    }

    setIsCancelling(false)
  }

  const getStatusBadge = (status: BuildStatus['status']) => {
    switch (status) {
      case 'none':
        return <Badge variant="secondary">Never Built</Badge>
      case 'analyzing':
        return <Badge variant="default" className="bg-blue-500">Analyzing...</Badge>
      case 'awaiting_input':
        return <Badge variant="default" className="bg-amber-500">Awaiting Input</Badge>
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
  if (!registryInfo?.available) {
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
        <div className="flex gap-2">
          {isBuilding && (
            <Button
              onClick={handleCancelBuild}
              disabled={isCancelling}
              variant="outline"
              size="sm"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancel
                </>
              )}
            </Button>
          )}
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
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Package manager selection prompt */}
        {buildInfo?.status === 'awaiting_input' && buildInfo.needsPackageManager && buildInfo.availableChoices && buildInfo.workflowId && (
          <div className="mb-4">
            <PackageManagerPrompt
              choices={buildInfo.availableChoices}
              workflowId={buildInfo.workflowId}
              onSelect={async () => {
                // Refresh build status after selection
                const status = await getBuildStatus(appId)
                setBuildInfo(status)
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

          {/* Registry Card */}
          <div className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground mb-1">Container Registry</div>
            {registryInfo?.available ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {registryInfo.registryType === 'ghcr' ? 'GHCR' : 'ACR'}
                  </Badge>
                  <span className="text-sm font-medium truncate">{registryInfo.registryName}</span>
                </div>
                {registryInfo.isWorkspaceDefault && (
                  <div className="text-xs text-muted-foreground">Using workspace default</div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => router.push('/settings/registries')}
                >
                  <Settings2 className="mr-1 h-3 w-3" />
                  Configure
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Not configured</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => router.push('/settings/registries')}
                >
                  <Settings2 className="mr-1 h-3 w-3" />
                  Configure Registry
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Error details with actionable suggestions */}
        {buildInfo?.status === 'failed' && buildInfo.error && (
          <BuildErrorDisplay error={buildInfo.error} workflowId={buildInfo.workflowId} />
        )}
      </CardContent>
    </Card>
  )
}

// Separate component for error display
function BuildErrorDisplay({ error, workflowId }: { error: string | null; workflowId?: string | null }) {
  const errorStr = error || 'Unknown error'
  const parsed = parseBuildError(errorStr)

  // Auto-expand if error contains multiple lines (likely has useful detail)
  const hasMultipleLines = errorStr.includes('\n')
  const [showFullError, setShowFullError] = useState(hasMultipleLines)

  return (
    <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-destructive">{parsed.summary}</div>
          {parsed.details && parsed.details !== errorStr && !hasMultipleLines && (
            <div className="text-sm text-muted-foreground mt-1">{parsed.details}</div>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {parsed.suggestions.length > 0 && (
        <div className="ml-8 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <span>How to fix</span>
          </div>
          <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 ml-1">
            {parsed.suggestions.map((suggestion, i) => (
              <li key={i}>{suggestion}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Full error output - shown by default for multi-line errors */}
      {showFullError && (
        <div className="ml-8 mt-2">
          <pre className="text-xs font-mono bg-muted/50 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
            {error}
          </pre>
        </div>
      )}

      {/* View full error / workflow link */}
      <div className="ml-8 flex items-center gap-4 pt-2">
        <button
          onClick={() => setShowFullError(!showFullError)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {showFullError ? 'Hide' : 'Show'} error details
        </button>
        {workflowId && (
          <a
            href={`http://localhost:8080/namespaces/default/workflows/${workflowId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline"
          >
            View in Temporal
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}
