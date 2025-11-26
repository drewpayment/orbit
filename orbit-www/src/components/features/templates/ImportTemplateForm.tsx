'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { importTemplate, checkManifestExists, CheckManifestResult } from '@/app/actions/templates'
import { ManifestBuilderForm } from './ManifestBuilderForm'

interface Workspace {
  id: string
  name: string
}

interface ImportTemplateFormProps {
  workspaces: Workspace[]
}

export function ImportTemplateForm({ workspaces }: ImportTemplateFormProps) {
  const router = useRouter()
  const [repoUrl, setRepoUrl] = useState('')
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '')
  const [manifestPath, setManifestPath] = useState('orbit-template.yaml')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const [step, setStep] = useState<'input' | 'wizard' | 'import'>('input')
  const [repoInfo, setRepoInfo] = useState<CheckManifestResult['repoInfo'] | null>(null)

  const handleImport = async () => {
    setError(null)
    setWarnings([])
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await importTemplate({
        repoUrl,
        workspaceId,
        manifestPath: manifestPath || undefined,
      })

      if (result.success) {
        setSuccess(true)
        if (result.warnings) {
          setWarnings(result.warnings)
        }
        // Redirect after short delay to show success
        setTimeout(() => {
          router.push('/templates')
        }, 1500)
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setWarnings([])
    setSuccess(false)
    setIsSubmitting(true)

    try {
      // First check if manifest exists
      const result = await checkManifestExists(repoUrl, workspaceId, manifestPath || undefined)

      if (result.error) {
        setError(result.error)
        setIsSubmitting(false)
        return
      }

      setRepoInfo(result.repoInfo || null)

      if (result.exists) {
        // Manifest exists, proceed to import
        await handleImport()
      } else {
        // Show wizard
        setStep('wizard')
        setIsSubmitting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  const handleManifestCreated = () => {
    // Reset to input step and auto-trigger import
    setStep('input')
    handleImport()
  }

  const handleCancel = () => {
    setStep('input')
    setRepoInfo(null)
  }

  // Render wizard if no manifest exists
  if (step === 'wizard' && repoInfo) {
    return (
      <ManifestBuilderForm
        repoUrl={repoUrl}
        workspaceId={workspaceId}
        repoInfo={repoInfo}
        onManifestCreated={handleManifestCreated}
        onCancel={handleCancel}
      />
    )
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Import Template</CardTitle>
        <CardDescription>
          Import a GitHub repository as a template. The repository must contain an
          orbit-template.yaml manifest file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Warnings Alert */}
          {warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">Success!</AlertTitle>
              <AlertDescription className="text-green-600">
                Template imported successfully. Redirecting...
              </AlertDescription>
            </Alert>
          )}

          {/* Repository URL */}
          <div className="space-y-2">
            <Label htmlFor="repoUrl">
              GitHub Repository URL <span className="text-red-500">*</span>
            </Label>
            <Input
              id="repoUrl"
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
              disabled={isSubmitting || success}
            />
            <p className="text-xs text-muted-foreground">
              The repository must be accessible via your workspace&apos;s GitHub App installation.
            </p>
          </div>

          {/* Workspace Selection */}
          <div className="space-y-2">
            <Label htmlFor="workspace">
              Workspace <span className="text-red-500">*</span>
            </Label>
            <Select
              value={workspaceId}
              onValueChange={setWorkspaceId}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Manifest Path */}
          <div className="space-y-2">
            <Label htmlFor="manifestPath">Manifest File Path</Label>
            <Input
              id="manifestPath"
              placeholder="orbit-template.yaml"
              value={manifestPath}
              onChange={(e) => setManifestPath(e.target.value)}
              disabled={isSubmitting || success}
            />
            <p className="text-xs text-muted-foreground">
              Path to the manifest file. Defaults to orbit-template.yaml in the repository root.
            </p>
          </div>

          {/* Submit Button */}
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || success || !repoUrl || !workspaceId}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import Template'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
