'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CheckCircle2, Info, ExternalLink } from 'lucide-react'
import { instantiateTemplate, type GitHubInstallationHealth } from '@/app/actions/templates'
import Link from 'next/link'

interface TemplateVariable {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  description?: string
  default?: string | number | boolean
  options?: Array<{ label: string; value: string }>
}

interface Workspace {
  id: string
  name: string
}

interface GitHubOrg {
  login: string
  name: string
}

interface UseTemplateFormProps {
  templateId: string
  templateName: string
  variables: TemplateVariable[]
  workspaces: Workspace[]
  githubOrgs: GitHubOrg[]
  githubInstallations: GitHubInstallationHealth[]
}

export function UseTemplateForm({
  templateId,
  templateName,
  variables,
  workspaces,
  githubOrgs,
  githubInstallations,
}: UseTemplateFormProps) {
  const router = useRouter()
  const [repoName, setRepoName] = useState('')
  const [repoDescription, setRepoDescription] = useState('')
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '')
  const [githubOrg, setGithubOrg] = useState(githubOrgs[0]?.login || '')
  const [isPrivate, setIsPrivate] = useState(true)
  const [variableValues, setVariableValues] = useState<Record<string, string | number | boolean>>(() => {
    // Initialize with defaults
    const defaults: Record<string, string | number | boolean> = {}
    variables.forEach((v) => {
      if (v.default !== undefined) {
        defaults[v.key] = v.default
      } else if (v.type === 'boolean') {
        defaults[v.key] = false
      } else if (v.type === 'number') {
        defaults[v.key] = 0
      } else {
        defaults[v.key] = ''
      }
    })
    return defaults
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleVariableChange = (key: string, value: string | number | boolean) => {
    setVariableValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setIsSubmitting(true)

    try {
      const result = await instantiateTemplate({
        templateId,
        repoName,
        repoDescription,
        workspaceId,
        githubOrg,
        isPrivate,
        variables: variableValues,
      })

      if (result.success) {
        setSuccess(true)
        // Redirect to the new repository or progress page
        setTimeout(() => {
          if (result.workflowId) {
            router.push(`/templates/progress/${result.workflowId}`)
          } else {
            router.push('/repositories')
          }
        }, 1500)
      } else {
        setError(result.error || 'Failed to create repository')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderVariableInput = (variable: TemplateVariable) => {
    const value = variableValues[variable.key]

    switch (variable.type) {
      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={variable.key}
              checked={value as boolean}
              onCheckedChange={(checked: boolean) => handleVariableChange(variable.key, !!checked)}
              disabled={isSubmitting || success}
            />
            <Label htmlFor={variable.key} className="text-sm font-normal">
              {variable.description || variable.key}
            </Label>
          </div>
        )

      case 'number':
        return (
          <Input
            id={variable.key}
            type="number"
            value={value as number}
            onChange={(e) => handleVariableChange(variable.key, parseInt(e.target.value, 10) || 0)}
            disabled={isSubmitting || success}
          />
        )

      case 'select':
        return (
          <Select
            value={value as string}
            onValueChange={(v) => handleVariableChange(variable.key, v)}
            disabled={isSubmitting || success}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {variable.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'multiselect':
        // For simplicity, render as comma-separated input (full implementation would use multi-select component)
        return (
          <Input
            id={variable.key}
            placeholder="Comma-separated values"
            value={value as string}
            onChange={(e) => handleVariableChange(variable.key, e.target.value)}
            disabled={isSubmitting || success}
          />
        )

      default:
        return (
          <Input
            id={variable.key}
            value={value as string}
            onChange={(e) => handleVariableChange(variable.key, e.target.value)}
            disabled={isSubmitting || success}
          />
        )
    }
  }

  // Determine diagnostic message for when no orgs are available
  const getDiagnosticMessage = () => {
    if (githubOrgs.length > 0) return null

    // No installations at all
    if (githubInstallations.length === 0) {
      return {
        title: 'No GitHub App Installed',
        description: 'Install the Orbit GitHub App to create repositories from templates.',
        action: { label: 'Install GitHub App', href: '/settings/github/install' },
      }
    }

    // Check if any installation has expired token
    const hasExpiredToken = githubInstallations.some(inst => inst.tokenExpired || inst.refreshFailed)
    if (hasExpiredToken) {
      return {
        title: 'GitHub Token Expired',
        description: 'Your GitHub token has expired and needs to be refreshed.',
        action: { label: 'Go to Settings', href: '/settings/github' },
      }
    }

    // Check if no installations are linked to workspace
    const hasUnlinkedInstallations = githubInstallations.some(inst => !inst.workspaceLinked)
    if (hasUnlinkedInstallations) {
      return {
        title: 'GitHub Not Linked to Workspace',
        description: 'Your GitHub installation is not linked to this workspace.',
        action: { label: 'Configure', href: '/settings/github' },
      }
    }

    // Generic fallback
    return {
      title: 'No GitHub Organizations Available',
      description: 'Please configure your GitHub connection to create repositories.',
      action: { label: 'Go to Settings', href: '/settings/github' },
    }
  }

  const diagnosticMessage = getDiagnosticMessage()

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl mx-auto">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">Creating Repository...</AlertTitle>
          <AlertDescription className="text-green-600">
            Your repository is being created from {templateName}. Redirecting...
          </AlertDescription>
        </Alert>
      )}

      {/* Diagnostic Message for No Orgs */}
      {diagnosticMessage && !success && (
        <Alert variant="default" className="border-blue-500 bg-blue-50 dark:bg-blue-950">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-600">{diagnosticMessage.title}</AlertTitle>
          <AlertDescription className="text-blue-600">
            {diagnosticMessage.description}
            <Link
              href={diagnosticMessage.action.href}
              className="ml-2 inline-flex items-center gap-1 underline hover:no-underline"
            >
              {diagnosticMessage.action.label}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Repository Details */}
      <Card>
        <CardHeader>
          <CardTitle>Repository Details</CardTitle>
          <CardDescription>
            Configure the new repository that will be created from this template.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Repository Name */}
          <div className="space-y-2">
            <Label htmlFor="repoName">
              Repository Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="repoName"
              placeholder="my-new-project"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              required
              disabled={isSubmitting || success}
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {/* Repository Description */}
          <div className="space-y-2">
            <Label htmlFor="repoDescription">Description</Label>
            <Textarea
              id="repoDescription"
              placeholder="A brief description of your project"
              value={repoDescription}
              onChange={(e) => setRepoDescription(e.target.value)}
              disabled={isSubmitting || success}
              rows={2}
            />
          </div>

          {/* GitHub Organization */}
          <div className="space-y-2">
            <Label htmlFor="githubOrg">
              GitHub Organization <span className="text-red-500">*</span>
            </Label>
            <Select
              value={githubOrg}
              onValueChange={setGithubOrg}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="githubOrg">
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                {githubOrgs.map((org) => (
                  <SelectItem key={org.login} value={org.login}>
                    {org.name || org.login}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Workspace */}
          <div className="space-y-2">
            <Label htmlFor="workspace">
              Orbit Workspace <span className="text-red-500">*</span>
            </Label>
            <Select
              value={workspaceId}
              onValueChange={setWorkspaceId}
              disabled={isSubmitting || success}
            >
              <SelectTrigger id="workspace">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The workspace where this repository will be registered.
            </p>
          </div>

          {/* Private Repository */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPrivate"
              checked={isPrivate}
              onCheckedChange={(checked: boolean) => setIsPrivate(!!checked)}
              disabled={isSubmitting || success}
            />
            <Label htmlFor="isPrivate" className="text-sm font-normal">
              Create as private repository
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Template Variables */}
      {variables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Template Variables</CardTitle>
            <CardDescription>
              Configure the template variables. These will be substituted in your new repository.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {variables.map((variable) => (
              <div key={variable.key} className="space-y-2">
                <Label htmlFor={variable.key}>
                  {variable.key}
                  {variable.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {renderVariableInput(variable)}
                {variable.description && variable.type !== 'boolean' && (
                  <p className="text-xs text-muted-foreground">{variable.description}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>What happens next?</AlertTitle>
        <AlertDescription>
          A new repository will be created in your GitHub organization using this template.
          Template variables will be substituted throughout the codebase.
        </AlertDescription>
      </Alert>

      {/* Submit Buttons */}
      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || success || !repoName || !workspaceId || !githubOrg}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Repository'
          )}
        </Button>
      </div>
    </form>
  )
}
