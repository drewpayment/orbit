'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { deleteLLMProvider } from './actions'

interface ProviderRow {
  id: string
  displayName: string
  provider: string
  baseUrl: string
  model: string
  isDefault: boolean
  workspaceId: string
  workspaceName: string
  updatedAt: string
}

interface WorkspaceOpt {
  id: string
  name: string
  slug: string
}

interface Props {
  providers: ProviderRow[]
  workspaces: WorkspaceOpt[]
}

export function LLMProvidersTable({ providers }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onDelete = (id: string, label: string) => {
    if (!confirm(`Delete provider "${label}"? This cannot be undone.`)) return
    startTransition(async () => {
      const res = await deleteLLMProvider(id)
      if (!res.success) {
        alert(`Delete failed: ${res.error}`)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground border-b">
          <tr>
            <th className="py-2 pr-4">Workspace</th>
            <th className="py-2 pr-4">Display name</th>
            <th className="py-2 pr-4">Provider</th>
            <th className="py-2 pr-4">Model</th>
            <th className="py-2 pr-4">Base URL</th>
            <th className="py-2 pr-4">Default</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {providers.map((p) => (
            <tr key={p.id} className="align-middle">
              <td className="py-2 pr-4">{p.workspaceName || p.workspaceId}</td>
              <td className="py-2 pr-4 font-medium">{p.displayName}</td>
              <td className="py-2 pr-4">
                <Badge variant="secondary">{p.provider}</Badge>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{p.model}</td>
              <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                {p.baseUrl || '(default)'}
              </td>
              <td className="py-2 pr-4">
                {p.isDefault ? <Badge>default</Badge> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => onDelete(p.id, p.displayName)}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
