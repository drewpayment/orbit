'use client'

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Copy, Check, Code, Clock, XCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  getConnectionDetails,
  type ConnectionDetails,
} from '@/app/actions/kafka-topic-catalog'
import { ServiceAccountSelector, type ServiceAccountInfo } from './ServiceAccountSelector'
import { CodeSnippetsDialog } from './CodeSnippetsDialog'

interface ConnectionDetailsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shareId: string
  workspaceSlug: string
}

export function ConnectionDetailsPanel({
  open,
  onOpenChange,
  shareId,
  workspaceSlug,
}: ConnectionDetailsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [codeSnippetsOpen, setCodeSnippetsOpen] = useState(false)

  useEffect(() => {
    if (open && shareId) {
      loadConnectionDetails()
    }
  }, [open, shareId])

  const loadConnectionDetails = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getConnectionDetails(shareId)
      if (result.success && result.connectionDetails) {
        setConnectionDetails(result.connectionDetails)
      } else {
        setError(result.error || 'Failed to load connection details')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )
    }

    if (error) {
      return (
        <Alert variant="destructive" className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )
    }

    if (!connectionDetails) {
      return (
        <Alert className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Not Found</AlertTitle>
          <AlertDescription>Connection details not available.</AlertDescription>
        </Alert>
      )
    }

    // Handle different share statuses
    if (connectionDetails.shareStatus === 'pending') {
      return (
        <Alert className="m-4">
          <Clock className="h-4 w-4" />
          <AlertTitle>Access Pending</AlertTitle>
          <AlertDescription>
            Your request to access this topic is awaiting approval. You will be able to connect
            once the owner approves.
          </AlertDescription>
        </Alert>
      )
    }

    if (connectionDetails.shareStatus === 'rejected') {
      return (
        <Alert variant="destructive" className="m-4">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Access Rejected</AlertTitle>
          <AlertDescription>
            Your request to access this topic was rejected. Contact the topic owner for more
            information.
          </AlertDescription>
        </Alert>
      )
    }

    if (connectionDetails.shareStatus === 'revoked') {
      return (
        <Alert variant="destructive" className="m-4">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Access Revoked</AlertTitle>
          <AlertDescription>
            Your access to this topic has been revoked. Contact the topic owner to request access
            again.
          </AlertDescription>
        </Alert>
      )
    }

    const serviceAccounts: ServiceAccountInfo[] = connectionDetails.serviceAccounts.map((sa) => ({
      id: sa.id,
      name: sa.name,
      username: sa.username,
      status: sa.status,
    }))

    return (
      <div className="space-y-6 p-4">
        {/* Connection Info */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Bootstrap Servers</Label>
            <div className="flex gap-2">
              <Input
                value={connectionDetails.bootstrapServers}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(connectionDetails.bootstrapServers, 'bootstrap')}
              >
                {copiedField === 'bootstrap' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Topic Name</Label>
            <div className="flex gap-2">
              <Input
                value={connectionDetails.topicName}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(connectionDetails.topicName, 'topic')}
              >
                {copiedField === 'topic' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Auth Method</Label>
              <Badge variant="outline">{connectionDetails.authMethod}</Badge>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">TLS</Label>
              <Badge variant={connectionDetails.tlsEnabled ? 'default' : 'secondary'}>
                {connectionDetails.tlsEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Service Accounts */}
        <ServiceAccountSelector
          serviceAccounts={serviceAccounts}
          applicationId={connectionDetails.applicationId}
          workspaceSlug={workspaceSlug}
        />

        {/* Divider */}
        <div className="border-t" />

        {/* Code Snippets Button */}
        <Button variant="outline" className="w-full" onClick={() => setCodeSnippetsOpen(true)}>
          <Code className="h-4 w-4 mr-2" />
          View Code Snippets
        </Button>

        {/* Code Snippets Dialog */}
        {serviceAccounts.length > 0 && (
          <CodeSnippetsDialog
            open={codeSnippetsOpen}
            onOpenChange={setCodeSnippetsOpen}
            connectionDetails={{
              bootstrapServers: connectionDetails.bootstrapServers,
              topicName: connectionDetails.topicName,
              username: serviceAccounts[0].username,
              authMethod: connectionDetails.authMethod,
              tlsEnabled: connectionDetails.tlsEnabled,
            }}
          />
        )}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Connection Details</SheetTitle>
          <SheetDescription>Use these details to connect to the shared topic</SheetDescription>
        </SheetHeader>
        {renderContent()}
      </SheetContent>
    </Sheet>
  )
}
