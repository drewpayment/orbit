'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface Workspace {
  id: string
  name: string
  slug: string
}

interface Installation {
  id: string
  accountLogin: string
  allowedWorkspaces?: string[]
}

export function ConfigureInstallationClient() {
  const params = useParams()
  const router = useRouter()
  const [installation, setInstallation] = useState<Installation | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    // Fetch installation details
    const installRes = await fetch(`/api/github/installations/${params.id}`)
    const installData = await installRes.json()
    setInstallation(installData)
    setSelectedWorkspaces(installData.allowedWorkspaces?.map((w: any) => w.id || w) || [])

    // Fetch all workspaces
    const workspacesRes = await fetch('/api/workspaces')
    const workspacesData = await workspacesRes.json()
    setWorkspaces(workspacesData.docs || [])
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/github/installations/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedWorkspaces: selectedWorkspaces,
        }),
      })

      router.push('/settings/github')
    } catch (error) {
      console.error('Failed to save configuration:', error)
    } finally {
      setSaving(false)
    }
  }

  function toggleWorkspace(workspaceId: string) {
    if (selectedWorkspaces.includes(workspaceId)) {
      setSelectedWorkspaces(selectedWorkspaces.filter(id => id !== workspaceId))
    } else {
      setSelectedWorkspaces([...selectedWorkspaces, workspaceId])
    }
  }

  if (!installation) {
    return <div>Loading...</div>
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">Configure GitHub Installation</h1>
      <p className="text-gray-600 mb-6">
        GitHub Organization: <strong>{installation.accountLogin}</strong>
      </p>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Workspace Access</h2>
        <p className="text-sm text-gray-600 mb-4">
          Select which Orbit workspaces can use this GitHub installation for repository operations.
        </p>

        <div className="space-y-3">
          {workspaces.map((workspace) => (
            <label
              key={workspace.id}
              className="flex items-center gap-3 p-3 border rounded hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedWorkspaces.includes(workspace.id)}
                onChange={() => toggleWorkspace(workspace.id)}
                className="w-4 h-4"
              />
              <div>
                <p className="font-medium">{workspace.name}</p>
                <p className="text-sm text-gray-600">{workspace.slug}</p>
              </div>
            </label>
          ))}
        </div>

        {workspaces.length === 0 && (
          <p className="text-sm text-gray-500 italic">No workspaces available</p>
        )}
      </Card>

      <div className="flex gap-3 mt-6">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
