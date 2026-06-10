'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || 'orbit-idp-dev'

interface Installation {
  id: string
  installationId: number
  accountLogin: string
  accountAvatarUrl?: string
  repositorySelection: 'all' | 'selected'
  selectedRepositories?: Array<{ fullName: string }>
  status: 'active' | 'suspended' | 'refresh_failed' | 'needs_reconnect'
  allowedWorkspaces?: any[]
  installedBy?: { email: string }
  suspensionReason?: string
  lastFailureReason?: string
}

// Maps the internal status to a low-noise, user-facing connection state. No
// engine vocabulary (Temporal/workflow) is ever surfaced here.
function connectionState(status: Installation['status']): {
  label: string
  badgeClass: string
  note: string
  actionRequired: boolean
} {
  switch (status) {
    case 'active':
      return { label: 'Connected', badgeClass: 'bg-green-100 text-green-800', note: 'Access token refreshes automatically.', actionRequired: false }
    case 'refresh_failed':
      return { label: 'Reconnecting…', badgeClass: 'bg-blue-100 text-blue-800', note: 'Briefly re-establishing the connection. No action needed.', actionRequired: false }
    case 'needs_reconnect':
      return { label: 'Action required', badgeClass: 'bg-amber-100 text-amber-800', note: 'Orbit can no longer authenticate. Reconnect to restore repository access.', actionRequired: true }
    case 'suspended':
      return { label: 'Suspended', badgeClass: 'bg-red-100 text-red-800', note: 'This connection is suspended. Reconnect to restore access.', actionRequired: true }
  }
}

function startReconnect() {
  const state = crypto.randomUUID()
  sessionStorage.setItem('github_install_state', state)
  window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`
}

export function GitHubSettingsClient() {
  const [installations, setInstallations] = useState<Installation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInstallations()
  }, [])

  async function fetchInstallations() {
    try {
      const res = await fetch('/api/github/installations')
      const data = await res.json()
      setInstallations(data.docs || [])
    } catch (error) {
      console.error('Failed to fetch installations:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleInstallGitHubApp() {
    // Generate CSRF state token
    const state = crypto.randomUUID()
    sessionStorage.setItem('github_install_state', state)

    // Redirect to GitHub App installation page
    const installUrl = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`
    window.location.href = installUrl
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">GitHub App Installations</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage GitHub organizations connected to Orbit
          </p>
        </div>
        <Button onClick={handleInstallGitHubApp}>
          + Install GitHub App
        </Button>
      </div>

      {installations.length === 0 ? (
        <Alert>
          <div>
            <p className="font-semibold">No GitHub installations configured</p>
            <p className="text-sm mt-1 text-gray-600">
              Install the Orbit IDP GitHub App into your GitHub organization to enable repository operations.
            </p>
            <Button className="mt-4" onClick={handleInstallGitHubApp}>
              Install GitHub App
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="space-y-4">
          {installations.map((install) => (
            <InstallationCard key={install.id} installation={install} />
          ))}
        </div>
      )}
    </>
  )
}

function InstallationCard({ installation }: { installation: Installation }) {
  const state = connectionState(installation.status)

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {installation.accountAvatarUrl && (
            <img
              src={installation.accountAvatarUrl}
              alt={installation.accountLogin}
              className="w-12 h-12 rounded"
            />
          )}
          <div>
            <h3 className="font-semibold text-lg">{installation.accountLogin}</h3>
            <p className="text-sm text-gray-600">
              {installation.repositorySelection === 'all'
                ? 'All repositories'
                : `${installation.selectedRepositories?.length || 0} selected repositories`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge className={state.badgeClass}>
            {state.label}
          </Badge>
          <Button
            variant="secondary"
            onClick={() => window.location.href = `/settings/github/${installation.id}/configure`}
          >
            Configure
          </Button>
        </div>
      </div>

      {state.actionRequired && (
        <Alert variant="destructive" className="mt-4">
          <p className="font-semibold">Action required — reconnect GitHub</p>
          <p className="text-sm">
            {installation.suspensionReason || installation.lastFailureReason || state.note}
          </p>
          <Button className="mt-3" size="sm" onClick={startReconnect}>
            Reconnect GitHub
          </Button>
        </Alert>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-gray-600">Allowed Workspaces</p>
          <p className="font-medium">{installation.allowedWorkspaces?.length || 0}</p>
        </div>
        <div>
          <p className="text-gray-600">Installed By</p>
          <p className="font-medium">{installation.installedBy?.email || 'Unknown'}</p>
        </div>
        <div>
          <p className="text-gray-600">Connection</p>
          <p className="font-medium">{state.note}</p>
        </div>
      </div>
    </Card>
  )
}
