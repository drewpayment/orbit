'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import type { MessageItem } from '@/app/actions/kafka-messages'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
})

interface MessageDetailProps {
  message: MessageItem
}

function tryPrettyJson(str: string | null): { content: string; language: string } {
  if (!str) return { content: '', language: 'plaintext' }
  try {
    const parsed = JSON.parse(str)
    return { content: JSON.stringify(parsed, null, 2), language: 'json' }
  } catch {
    return { content: str, language: 'plaintext' }
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

export function MessageDetail({ message }: MessageDetailProps) {
  const value = tryPrettyJson(message.value)
  const key = tryPrettyJson(message.key)
  const headerEntries = Object.entries(message.headers)

  return (
    <div className="border-t bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
        <span>Partition {message.partition}</span>
        <span>&middot;</span>
        <span>Offset {message.offset}</span>
        <span>&middot;</span>
        <span>Key: {formatBytes(message.keySize)}</span>
        <span>&middot;</span>
        <span>Value: {formatBytes(message.valueSize)}</span>
        {message.truncated && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            Truncated
          </Badge>
        )}
      </div>

      <Tabs defaultValue="value" className="w-full">
        <TabsList className="h-8">
          <TabsTrigger value="value" className="text-xs px-3 h-7">
            Value
          </TabsTrigger>
          <TabsTrigger value="key" className="text-xs px-3 h-7">
            Key
          </TabsTrigger>
          {headerEntries.length > 0 && (
            <TabsTrigger value="headers" className="text-xs px-3 h-7">
              Headers ({headerEntries.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="value" className="mt-2">
          <div className="relative">
            <div className="absolute top-2 right-2 z-10">
              <CopyButton text={value.content} />
            </div>
            <MonacoEditor
              height="300px"
              language={value.language}
              value={value.content}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                fontSize: 13,
                wordWrap: 'on',
                folding: true,
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="key" className="mt-2">
          <div className="relative">
            <div className="absolute top-2 right-2 z-10">
              <CopyButton text={key.content} />
            </div>
            <MonacoEditor
              height="200px"
              language={key.language}
              value={key.content || '(null)'}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'off',
                fontSize: 13,
                wordWrap: 'on',
              }}
            />
          </div>
        </TabsContent>

        {headerEntries.length > 0 && (
          <TabsContent value="headers" className="mt-2">
            <div className="rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-medium p-2 text-muted-foreground">
                      Key
                    </th>
                    <th className="text-left font-medium p-2 text-muted-foreground">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {headerEntries.map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="p-2 font-mono text-xs">{k}</td>
                      <td className="p-2 font-mono text-xs">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
