'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Upload, Loader2 } from 'lucide-react'
import { exportAppManifest } from '@/app/actions/apps'
import { toast } from 'sonner'
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

interface ExportManifestButtonProps {
  appId: string
  syncEnabled: boolean
  hasRepository: boolean
  manifestPath?: string
}

export function ExportManifestButton({
  appId,
  syncEnabled,
  hasRepository,
  manifestPath = '.orbit.yaml',
}: ExportManifestButtonProps) {
  const router = useRouter()
  const [isExporting, setIsExporting] = React.useState(false)

  if (syncEnabled || !hasRepository) return null

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportAppManifest(appId)
      toast.success('Manifest exported — sync is now active')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export manifest')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting}>
          <Upload className="h-4 w-4 mr-2" />
          Export to Repository
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Export manifest to repository?</AlertDialogTitle>
          <AlertDialogDescription>
            This will commit a <code>{manifestPath}</code> file to your repository and enable
            bidirectional sync. Future changes in Orbit will be committed to the repo, and
            changes pushed to the repo will update Orbit.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              'Export & Enable Sync'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
