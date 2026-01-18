'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Copy, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  generateJavaSnippet,
  generatePythonSnippet,
  generateNodejsSnippet,
  generateGoSnippet,
  type CodeSnippetParams,
} from './code-snippets'

interface CodeSnippetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionDetails: CodeSnippetParams
}

const languages = [
  { id: 'nodejs', label: 'Node.js', generator: generateNodejsSnippet },
  { id: 'python', label: 'Python', generator: generatePythonSnippet },
  { id: 'java', label: 'Java', generator: generateJavaSnippet },
  { id: 'go', label: 'Go', generator: generateGoSnippet },
] as const

export function CodeSnippetsDialog({
  open,
  onOpenChange,
  connectionDetails,
}: CodeSnippetsDialogProps) {
  const [activeTab, setActiveTab] = useState<string>('nodejs')
  const [copied, setCopied] = useState(false)

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Code copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy code')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Code Snippets</DialogTitle>
          <DialogDescription>
            Ready-to-use code for connecting to {connectionDetails.topicName}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-4">
            {languages.map((lang) => (
              <TabsTrigger key={lang.id} value={lang.id}>
                {lang.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {languages.map((lang) => (
            <TabsContent
              key={lang.id}
              value={lang.id}
              className="flex-1 overflow-hidden flex flex-col mt-4"
            >
              <div className="relative flex-1 overflow-auto rounded-lg border bg-muted">
                <pre className="p-4 text-sm overflow-x-auto">
                  <code>{lang.generator(connectionDetails)}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => copyCode(lang.generator(connectionDetails))}
                >
                  {copied && activeTab === lang.id ? (
                    <>
                      <Check className="h-4 w-4 mr-1 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <Alert variant="default" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Never commit credentials to version control. Use environment variables for the
            password.
          </AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  )
}
