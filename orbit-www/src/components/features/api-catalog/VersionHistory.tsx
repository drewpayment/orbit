'use client'

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Eye, RotateCcw, User, Loader2 } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface Version {
  id: string
  version: string
  versionNumber: number
  rawContent: string
  releaseNotes?: string
  createdBy: { id: string; email: string; name?: string } | string
  createdAt: string
}

interface VersionHistoryProps {
  versions: Version[]
  currentVersionNumber?: number
  onViewVersion: (content: string) => void
  onRestoreVersion?: (versionId: string) => Promise<void>
}

export function VersionHistory({
  versions,
  currentVersionNumber,
  onViewVersion,
  onRestoreVersion,
}: VersionHistoryProps) {
  const [restoringId, setRestoringId] = React.useState<string | null>(null)

  const handleRestore = async (versionId: string) => {
    if (!onRestoreVersion) return

    setRestoringId(versionId)
    try {
      await onRestoreVersion(versionId)
    } finally {
      setRestoringId(null)
    }
  }

  if (versions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Version History</CardTitle>
          <CardDescription>No versions available</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version History</CardTitle>
        <CardDescription>
          {versions.length} version{versions.length !== 1 ? 's' : ''} recorded
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {versions.map((version, index) => {
            const isCurrent = version.versionNumber === currentVersionNumber
            const createdByName =
              typeof version.createdBy === 'object'
                ? version.createdBy.name || version.createdBy.email
                : 'Unknown'

            return (
              <React.Fragment key={version.id}>
                {index > 0 && <Separator />}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{version.version}</span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-xs">
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span title={format(new Date(version.createdAt), 'PPpp')}>
                        {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {createdByName}
                      </span>
                    </div>
                    {version.releaseNotes && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {version.releaseNotes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewVersion(version.rawContent)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>

                    {onRestoreVersion && !isCurrent && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={restoringId === version.id}
                          >
                            {restoringId === version.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4 mr-1" />
                            )}
                            Restore
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Restore version {version.version}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will create a new version with the content from version{' '}
                              {version.version}. The current version will be preserved in the
                              history.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRestore(version.id)}
                              disabled={restoringId === version.id}
                            >
                              Restore
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
