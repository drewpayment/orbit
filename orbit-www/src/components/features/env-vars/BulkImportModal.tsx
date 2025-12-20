'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseEnvFile, type ParsedEnvVariable } from '@/lib/env-parser'
import { bulkImportEnvironmentVariables } from '@/app/actions/environment-variables'

interface BulkImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  appId?: string
  onSuccess?: () => void
}

export function BulkImportModal({
  open,
  onOpenChange,
  workspaceId,
  appId,
  onSuccess,
}: BulkImportModalProps) {
  const [isPending, startTransition] = useTransition()
  const [input, setInput] = useState('')
  const [parsedVariables, setParsedVariables] = useState<ParsedEnvVariable[]>([])
  const [parseErrors, setParseErrors] = useState<Array<{ line: number; message: string }>>([])
  const [useInBuilds, setUseInBuilds] = useState(true)
  const [useInDeployments, setUseInDeployments] = useState(true)

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      setInput('')
      setParsedVariables([])
      setParseErrors([])
      setUseInBuilds(true)
      setUseInDeployments(true)
    }
  }, [open])

  // Parse input as user types
  useEffect(() => {
    if (!input.trim()) {
      setParsedVariables([])
      setParseErrors([])
      return
    }

    const result = parseEnvFile(input)
    setParsedVariables(result.variables)
    setParseErrors(result.errors)
  }, [input])

  const handleImport = () => {
    if (parsedVariables.length === 0) {
      toast.error('No valid variables to import')
      return
    }

    startTransition(async () => {
      const result = await bulkImportEnvironmentVariables({
        workspaceId,
        appId,
        variables: parsedVariables.map((v) => ({
          name: v.name,
          value: v.value,
        })),
        useInBuilds,
        useInDeployments,
      })

      if (result.success) {
        toast.success(`Imported ${result.imported} variable${result.imported !== 1 ? 's' : ''}`)
        onOpenChange(false)
        onSuccess?.()
      } else if (result.imported > 0) {
        toast.warning(
          `Imported ${result.imported} variable${result.imported !== 1 ? 's' : ''}, ${result.errors.length} failed`
        )
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to import variables')
      }
    })
  }

  const maskValue = (value: string): string => {
    if (value.length <= 8) {
      return '••••••••'
    }
    return value.slice(0, 4) + '••••' + value.slice(-4)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Environment Variables</DialogTitle>
          <DialogDescription>
            Paste your .env file contents below. Standard .env format is supported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Input textarea */}
          <div className="space-y-2">
            <Label htmlFor="envInput">Paste .env contents</Label>
            <Textarea
              id="envInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`# Example format:
TURSO_DATABASE_URL=libsql://your-db.turso.io
NEXT_PUBLIC_API_URL=https://api.example.com
ANALYTICS_KEY=UA-12345678
# Comments are ignored
NODE_ENV=production`}
              rows={8}
              className="font-mono text-sm"
              disabled={isPending}
            />
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm">
              <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                <AlertCircle className="h-4 w-4" />
                {parseErrors.length} parse error{parseErrors.length !== 1 ? 's' : ''}
              </div>
              <ul className="space-y-1 text-destructive/80">
                {parseErrors.map((error, i) => (
                  <li key={i}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview */}
          {parsedVariables.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <Label>Preview ({parsedVariables.length} variables detected)</Label>
              </div>
              <div className="rounded-md border max-h-[200px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Value (masked)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedVariables.map((v, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{v.name}</td>
                        <td className="p-2 font-mono text-muted-foreground">
                          {maskValue(v.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Default settings */}
          <div className="space-y-3">
            <Label>Default settings for imported variables</Label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bulkUseInBuilds"
                  checked={useInBuilds}
                  onCheckedChange={(checked) => setUseInBuilds(checked === true)}
                  disabled={isPending}
                />
                <Label htmlFor="bulkUseInBuilds" className="font-normal cursor-pointer">
                  Use in Builds
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bulkUseInDeployments"
                  checked={useInDeployments}
                  onCheckedChange={(checked) => setUseInDeployments(checked === true)}
                  disabled={isPending}
                />
                <Label htmlFor="bulkUseInDeployments" className="font-normal cursor-pointer">
                  Use in Deployments
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={isPending || parsedVariables.length === 0}
          >
            {isPending
              ? 'Importing...'
              : `Import ${parsedVariables.length} Variable${parsedVariables.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
