'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Download, FileCode } from 'lucide-react'
import { toast } from 'sonner'
import type { KafkaSchema } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

interface SchemaViewerProps {
  schemas: KafkaSchema[]
  topicName: string
}

const formatConfig = {
  avro: {
    label: 'Avro',
    color: 'bg-blue-100 text-blue-800',
  },
  protobuf: {
    label: 'Protobuf',
    color: 'bg-purple-100 text-purple-800',
  },
  json: {
    label: 'JSON Schema',
    color: 'bg-green-100 text-green-800',
  },
}

export function SchemaViewer({ schemas, topicName }: SchemaViewerProps) {
  const keySchema = schemas.find((s) => s.type === 'key')
  const valueSchema = schemas.find((s) => s.type === 'value')

  const copyToClipboard = async (content: string) => {
    await navigator.clipboard.writeText(content)
    toast.success('Schema copied to clipboard')
  }

  const downloadSchema = (schema: KafkaSchema) => {
    const blob = new Blob([schema.content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${topicName}-${schema.type}-schema.${schema.format === 'protobuf' ? 'proto' : schema.format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const renderSchema = (schema: KafkaSchema | undefined, type: 'key' | 'value') => {
    if (!schema) {
      return (
        <div className="text-center py-8 text-gray-500">
          <FileCode className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <p>No {type} schema registered</p>
          <Button variant="outline" size="sm" className="mt-4">
            Register Schema
          </Button>
        </div>
      )
    }

    const config = formatConfig[schema.format] || formatConfig.json

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className={config.color}>
              {config.label}
            </Badge>
            <Badge variant="outline">Version {schema.version}</Badge>
            <Badge variant="outline" className="capitalize">
              {schema.compatibility}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(schema.content)}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadSchema(schema)}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          </div>
        </div>

        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            <code>{formatSchemaContent(schema.content, schema.format)}</code>
          </pre>
        </div>

        <div className="text-sm text-gray-500">
          Schema ID: {schema.schemaId} | Subject: {schema.subject}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCode className="h-5 w-5" />
          Schemas
        </CardTitle>
        <CardDescription>
          Key and value schemas for message serialization
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="value">
          <TabsList>
            <TabsTrigger value="key">Key Schema</TabsTrigger>
            <TabsTrigger value="value">Value Schema</TabsTrigger>
          </TabsList>
          <TabsContent value="key" className="mt-4">
            {renderSchema(keySchema, 'key')}
          </TabsContent>
          <TabsContent value="value" className="mt-4">
            {renderSchema(valueSchema, 'value')}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function formatSchemaContent(content: string, format: string): string {
  try {
    if (format === 'json' || format === 'avro') {
      return JSON.stringify(JSON.parse(content), null, 2)
    }
    return content
  } catch {
    return content
  }
}
