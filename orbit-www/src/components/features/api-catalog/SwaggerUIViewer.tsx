'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { Loader2, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { parse as parseYaml } from 'yaml'
import '@scalar/api-reference-react/style.css'

const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((mod) => mod.ApiReferenceReact),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading API documentation...</span>
      </div>
    ),
  }
)

interface APISpecViewerProps {
  /** OpenAPI or AsyncAPI spec content (YAML or JSON string) */
  spec: string
  /** Optional version label to display */
  version?: string
  /** Additional class names */
  className?: string
}

function parseSpec(content: string): { spec: Record<string, unknown> | null; error: string | null } {
  if (!content?.trim()) {
    return { spec: null, error: 'No specification content provided' }
  }

  try {
    return { spec: JSON.parse(content), error: null }
  } catch {
    try {
      const parsed = parseYaml(content)
      if (!parsed || typeof parsed !== 'object') {
        return { spec: null, error: 'Invalid specification format' }
      }
      return { spec: parsed as Record<string, unknown>, error: null }
    } catch (yamlError) {
      return {
        spec: null,
        error: `Failed to parse specification: ${yamlError instanceof Error ? yamlError.message : 'Unknown error'}`,
      }
    }
  }
}

export function APISpecViewer({ spec, version, className }: APISpecViewerProps) {
  const { spec: parsedSpec, error } = React.useMemo(() => parseSpec(spec), [spec])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-semibold">Failed to load API documentation</div>
          <p className="text-sm mt-1">{error}</p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className={className}>
      {version && (
        <div className="mb-4 text-sm text-muted-foreground">
          Viewing version: <span className="font-medium">{version}</span>
        </div>
      )}
      <ApiReferenceReact
        configuration={{
          content: parsedSpec,
          hideTestRequestButton: true,
          hideClientButton: true,
          darkMode: true,
          layout: 'classic',
          hideDarkModeToggle: true,
        }}
      />
    </div>
  )
}

/** @deprecated Use APISpecViewer instead */
export const SwaggerUIViewer = APISpecViewer
