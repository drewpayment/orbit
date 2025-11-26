'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { syncTemplateManifest } from '@/app/actions/templates'

interface SyncHistoryEntry {
  timestamp: string
  status: 'success' | 'error'
  error?: string
}

interface TemplateSyncStatusProps {
  templateId: string
  syncStatus: 'synced' | 'error' | 'pending'
  syncError?: string | null
  lastSyncedAt?: string | null
  canSync: boolean // true if user has admin/owner permissions
  syncHistory?: SyncHistoryEntry[]
  showHistory?: boolean
}

export function TemplateSyncStatus({
  templateId,
  syncStatus,
  syncError,
  lastSyncedAt,
  canSync,
  syncHistory = [],
  showHistory = false
}: TemplateSyncStatusProps) {
  const [syncing, setSyncing] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(syncStatus)
  const [currentError, setCurrentError] = useState(syncError)
  const [currentLastSynced, setCurrentLastSynced] = useState(lastSyncedAt)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await syncTemplateManifest(templateId)
      if (result.success) {
        setCurrentStatus('synced')
        setCurrentError(null)
        setCurrentLastSynced(new Date().toISOString())
      } else {
        setCurrentStatus('error')
        setCurrentError(result.error || 'Sync failed')
      }
    } catch (_error) {
      setCurrentStatus('error')
      setCurrentError('Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
    return `${Math.floor(seconds / 86400)} days ago`
  }

  return (
    <div className="space-y-4">
      {/* Status Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {currentStatus === 'synced' && (
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Synced
            </Badge>
          )}
          {currentStatus === 'error' && (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              Error
            </Badge>
          )}
          {currentStatus === 'pending' && (
            <Badge className="bg-yellow-100 text-yellow-800">
              <Clock className="h-3 w-3 mr-1" />
              Pending
            </Badge>
          )}
          {currentLastSynced && (
            <span className="text-sm text-muted-foreground">
              Last synced {formatRelativeTime(currentLastSynced)}
            </span>
          )}
        </div>

        {canSync && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Now
          </Button>
        )}
      </div>

      {/* Error Alert */}
      {currentStatus === 'error' && currentError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{currentError}</AlertDescription>
        </Alert>
      )}

      {/* Sync History */}
      {showHistory && syncHistory.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-sm font-semibold mb-3">Recent Sync History</h4>
          <div className="space-y-2">
            {syncHistory.slice(0, 5).map((entry, index) => (
              <div key={index} className="flex items-start justify-between text-sm">
                <div className="flex items-center gap-2">
                  {entry.status === 'success' ? (
                    <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-red-600 flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </div>
                {entry.error && (
                  <span className="text-xs text-red-600 ml-2">{entry.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
