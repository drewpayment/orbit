'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import { createLLMProvider } from '../actions'

interface WorkspaceOpt {
  id: string
  name: string
  slug: string
}

interface Props {
  workspaces: WorkspaceOpt[]
}

const presets: Record<string, { baseUrl: string; placeholderModel: string }> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', placeholderModel: 'claude-opus-4-7' },
  openai_compat: { baseUrl: 'https://api.openai.com', placeholderModel: 'gpt-4o' },
}

export function NewLLMProviderForm({ workspaces }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [displayName, setDisplayName] = useState('')
  const [provider, setProvider] = useState<'anthropic' | 'openai_compat'>('anthropic')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!workspaceId) return setError('Select a workspace')
    if (!displayName.trim()) return setError('Display name is required')
    if (!model.trim()) return setError('Model is required')

    startTransition(async () => {
      const res = await createLLMProvider({
        workspaceId,
        displayName: displayName.trim(),
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
        isDefault,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/platform/llm-providers')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="workspace">Workspace</Label>
        <Select value={workspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger id="workspace">
            <SelectValue placeholder="Select workspace" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name} <span className="text-muted-foreground ml-2">({w.slug})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Anthropic prod key"
        />
        <p className="text-xs text-muted-foreground">
          Shown in the agent run UI; must be unique per workspace.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="provider">Provider</Label>
        <Select
          value={provider}
          onValueChange={(v) => {
            const next = v as 'anthropic' | 'openai_compat'
            setProvider(next)
            // Pre-fill base URL with the provider's default if blank.
            if (!baseUrl) setBaseUrl(presets[next].baseUrl)
          }}
        >
          <SelectTrigger id="provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="openai_compat">
              OpenAI-compatible (OpenAI, LM Studio, Ollama, vLLM)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input
          id="baseUrl"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={presets[provider].baseUrl}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Defaults: <code>{presets[provider].baseUrl}</code>. Override for self-hosted backends
          (LM Studio: <code>http://host.docker.internal:1234</code>, Ollama:{' '}
          <code>http://host.docker.internal:11434</code>).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Input
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={presets[provider].placeholderModel}
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API key</Label>
        <Input
          id="apiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
        />
        <p className="text-xs text-muted-foreground">
          Encrypted at rest. Leave blank for self-hosted backends that don&apos;t require a key.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="isDefault"
          checked={isDefault}
          onCheckedChange={(v) => setIsDefault(Boolean(v))}
        />
        <Label htmlFor="isDefault" className="font-normal">
          Set as default provider for this workspace
        </Label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create provider'}
        </Button>
      </div>
    </form>
  )
}
