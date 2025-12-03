'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, Copy, FileCode } from 'lucide-react'
import { toast } from 'sonner'

interface GeneratedFile {
  path: string
  content: string
}

interface GeneratedFilesViewProps {
  files: GeneratedFile[]
}

export function GeneratedFilesView({ files }: GeneratedFilesViewProps) {
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  const handleCopy = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopiedFile(file.path)
      toast.success(`Copied ${file.path}`)
      setTimeout(() => setCopiedFile(null), 2000)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No files generated.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <FileCode className="h-4 w-4" />
        Generated Files
      </h4>

      {files.map((file) => (
        <div key={file.path} className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
            <span className="text-sm font-mono">{file.path}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(file)}
            >
              {copiedFile === file.path ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <ScrollArea className="h-[200px]">
            <pre className="p-3 text-sm font-mono whitespace-pre-wrap">
              {file.content}
            </pre>
          </ScrollArea>
        </div>
      ))}
    </div>
  )
}
