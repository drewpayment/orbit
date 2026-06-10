'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { startAgentRun } from '@/app/actions/infra-agent'

// CrossWorkspaceAgentRunForm — the top-level Infra Agent launcher.
//
// Workspaces remain the security enclave at the workflow level: every
// agent run is scoped to exactly one workspace, and all orbit_* tools
// stay workspace-filtered. What changes here is *where* that workspace
// comes from — the user picks an *app* from any workspace they belong
// to, and we derive `workspaceId = app.workspace` from the picked app.
// The startAgentRun server action re-validates workspace membership.

export interface AppOption {
  id: string
  name: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
}

export interface ProviderOption {
  id: string
  displayName: string
  provider: string
  model: string
  isDefault: boolean
  workspaceId: string
}

interface Props {
  apps: AppOption[]
  providers: ProviderOption[]
}

export function CrossWorkspaceAgentRunForm({ apps, providers }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [appId, setAppId] = useState<string>('')
  const [providerId, setProviderId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Apps grouped by workspace for the picker.
  const appsByWorkspace = useMemo(() => {
    const groups = new Map<string, { workspaceName: string; apps: AppOption[] }>()
    for (const app of apps) {
      const g = groups.get(app.workspaceId)
      if (g) {
        g.apps.push(app)
      } else {
        groups.set(app.workspaceId, { workspaceName: app.workspaceName, apps: [app] })
      }
    }
    // Sort each group's apps alphabetically; workspace order follows
    // first-seen in the apps array (the page query already sorts by
    // workspace name).
    for (const g of groups.values()) g.apps.sort((a, b) => a.name.localeCompare(b.name))
    return Array.from(groups.entries()).map(([workspaceId, g]) => ({
      workspaceId,
      workspaceName: g.workspaceName,
      apps: g.apps,
    }))
  }, [apps])

  const pickedApp = useMemo(() => apps.find((a) => a.id === appId) ?? null, [apps, appId])

  // Filter LLM providers to the picked app's workspace (providers are
  // workspace-scoped — see LLMProviders collection). If no app is
  // picked yet, show nothing; the user picks an app first.
  const availableProviders = useMemo(() => {
    if (!pickedApp) return []
    return providers.filter((p) => p.workspaceId === pickedApp.workspaceId)
  }, [providers, pickedApp])

  // When the picked app changes, reset the provider to that workspace's
  // default (or the first provider) so the user doesn't have to re-pick.
  const onPickApp = (id: string) => {
    setAppId(id)
    const app = apps.find((a) => a.id === id) ?? null
    if (!app) {
      setProviderId('')
      return
    }
    const wsProviders = providers.filter((p) => p.workspaceId === app.workspaceId)
    const fallback = wsProviders.find((p) => p.isDefault) ?? wsProviders[0]
    setProviderId(fallback?.id ?? '')
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!pickedApp) {
      setError('Pick an app to deploy')
      return
    }
    if (!providerId) {
      setError(
        availableProviders.length === 0
          ? `No LLM provider configured for "${pickedApp.workspaceName}" — ask a platform admin to add one.`
          : 'Select an LLM provider',
      )
      return
    }
    if (!prompt.trim()) {
      setError('Tell the agent what to do')
      return
    }
    startTransition(async () => {
      const result = await startAgentRun({
        workspaceId: pickedApp.workspaceId,
        repositoryId: pickedApp.id,
        llmProviderId: providerId,
        initialPrompt: prompt,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      router.push(
        `/workspaces/${pickedApp.workspaceSlug}/infra-agent/${encodeURIComponent(result.workflowId)}`,
      )
    })
  }

  if (apps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No apps to deploy yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The Infra Agent deploys apps that are registered in a workspace. You&apos;re a member of
            workspaces but none of them have apps yet — add an app from a workspace&apos;s Applications
            page and come back.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a new run</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app">App</Label>
            <Select value={appId} onValueChange={onPickApp}>
              <SelectTrigger id="app">
                <SelectValue placeholder="Pick an app to deploy" />
              </SelectTrigger>
              <SelectContent>
                {appsByWorkspace.map((group) => (
                  <SelectGroup key={group.workspaceId}>
                    <SelectLabel>{group.workspaceName}</SelectLabel>
                    {group.apps.map((app) => (
                      <SelectItem key={app.id} value={app.id}>
                        {app.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {pickedApp && (
              <p className="text-xs text-muted-foreground">
                This run will be scoped to <strong>{pickedApp.workspaceName}</strong>. The agent can
                only see apps, cloud accounts, and tools in that workspace.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider">LLM provider</Label>
            <Select
              value={providerId}
              onValueChange={setProviderId}
              disabled={!pickedApp || availableProviders.length === 0}
            >
              <SelectTrigger id="provider">
                <SelectValue
                  placeholder={
                    !pickedApp
                      ? 'Pick an app first'
                      : availableProviders.length === 0
                        ? 'No provider configured for this workspace'
                        : 'Select provider'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName} — {p.provider}/{p.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">What should the agent do?</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Deploy this Next.js app to Azure App Service in the prod subscription, west-us region."
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !pickedApp}>
              {pending ? 'Starting…' : 'Start agent'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
