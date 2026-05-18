'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { startAgentRun } from '@/app/actions/infra-agent'

interface ProviderOption {
  id: string
  displayName: string
  provider: string
  model: string
  isDefault: boolean
}

interface Props {
  workspaceId: string
  slug: string
  providers: ProviderOption[]
}

export function NewAgentRunForm({ workspaceId, slug, providers }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const defaultProvider = providers.find((p) => p.isDefault)?.id ?? providers[0]?.id ?? ''
  const [providerId, setProviderId] = useState(defaultProvider)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!prompt.trim()) {
      setError('Prompt is required')
      return
    }
    if (!providerId) {
      setError('Select an LLM provider')
      return
    }
    startTransition(async () => {
      const result = await startAgentRun({
        workspaceId,
        llmProviderId: providerId,
        initialPrompt: prompt,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      router.push(`/workspaces/${slug}/infra-agent/${encodeURIComponent(result.workflowId)}`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a new run</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">LLM provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Starting…' : 'Start agent'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
