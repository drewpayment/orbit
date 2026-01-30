'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { Loader2, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { parse as parseYaml } from 'yaml'
import 'swagger-ui-react/swagger-ui.css'

// Dynamically import SwaggerUI to avoid SSR issues and reduce initial bundle
const SwaggerUI = dynamic(
  () => import('swagger-ui-react'),
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

interface SwaggerUIViewerProps {
  /** OpenAPI spec content (YAML or JSON string) */
  spec: string
  /** Optional version label to display */
  version?: string
  /** Additional class names */
  className?: string
}

interface ParsedSpec {
  spec: Record<string, unknown>
  error: string | null
}

function parseSpec(content: string): ParsedSpec {
  if (!content || !content.trim()) {
    return { spec: {}, error: 'No specification content provided' }
  }

  try {
    // Try parsing as JSON first
    const parsed = JSON.parse(content)
    return { spec: parsed, error: null }
  } catch {
    // Fall back to YAML
    try {
      const parsed = parseYaml(content)
      if (!parsed || typeof parsed !== 'object') {
        return { spec: {}, error: 'Invalid specification format' }
      }
      return { spec: parsed as Record<string, unknown>, error: null }
    } catch (yamlError) {
      return {
        spec: {},
        error: `Failed to parse specification: ${yamlError instanceof Error ? yamlError.message : 'Unknown error'}`,
      }
    }
  }
}

export function SwaggerUIViewer({ spec, version, className }: SwaggerUIViewerProps) {
  const [mounted, setMounted] = React.useState(false)
  const { spec: parsedSpec, error } = React.useMemo(() => parseSpec(spec), [spec])

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
      <div className="swagger-ui-wrapper">
        <SwaggerUI
          spec={parsedSpec}
          docExpansion="list"
          defaultModelsExpandDepth={1}
          displayOperationId={false}
          filter={true}
          showExtensions={false}
          showCommonExtensions={false}
          tryItOutEnabled={false}
        />
      </div>
      <style jsx global>{`
        /* Swagger UI theme overrides for Orbit */
        .swagger-ui-wrapper .swagger-ui {
          font-family: inherit;
        }

        .swagger-ui-wrapper .swagger-ui .info .title {
          font-family: inherit;
          color: hsl(var(--foreground));
        }

        .swagger-ui-wrapper .swagger-ui .info {
          margin: 20px 0;
        }

        .swagger-ui-wrapper .swagger-ui .scheme-container {
          background: hsl(var(--muted));
          padding: 15px;
          border-radius: 8px;
        }

        .swagger-ui-wrapper .swagger-ui .opblock-tag {
          border-bottom: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
        }

        .swagger-ui-wrapper .swagger-ui .opblock {
          border-radius: 8px;
          margin-bottom: 12px;
          border: 1px solid hsl(var(--border));
          box-shadow: none;
        }

        .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary {
          border-bottom: 1px solid hsl(var(--border));
        }

        .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary-method {
          border-radius: 4px;
          font-weight: 600;
        }

        .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary-path {
          font-family: ui-monospace, monospace;
        }

        .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary-description {
          color: hsl(var(--muted-foreground));
        }

        .swagger-ui-wrapper .swagger-ui .opblock-body pre {
          background: hsl(var(--muted));
          border-radius: 6px;
        }

        .swagger-ui-wrapper .swagger-ui .model-box {
          background: hsl(var(--muted));
          border-radius: 6px;
        }

        .swagger-ui-wrapper .swagger-ui section.models {
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
        }

        .swagger-ui-wrapper .swagger-ui section.models h4 {
          color: hsl(var(--foreground));
        }

        .swagger-ui-wrapper .swagger-ui .model-title {
          font-family: ui-monospace, monospace;
        }

        .swagger-ui-wrapper .swagger-ui table tbody tr td {
          padding: 10px;
          border-bottom: 1px solid hsl(var(--border));
        }

        .swagger-ui-wrapper .swagger-ui .response-col_status {
          font-family: ui-monospace, monospace;
        }

        .swagger-ui-wrapper .swagger-ui .btn {
          border-radius: 6px;
        }

        .swagger-ui-wrapper .swagger-ui select {
          border-radius: 6px;
          border: 1px solid hsl(var(--border));
        }

        .swagger-ui-wrapper .swagger-ui input[type=text] {
          border-radius: 6px;
          border: 1px solid hsl(var(--border));
        }

        /* Dark mode support */
        .dark .swagger-ui-wrapper .swagger-ui {
          filter: invert(0.88) hue-rotate(180deg);
        }

        .dark .swagger-ui-wrapper .swagger-ui img {
          filter: invert(1) hue-rotate(180deg);
        }

        .dark .swagger-ui-wrapper .swagger-ui .opblock-summary-method {
          filter: none;
        }

        .dark .swagger-ui-wrapper .swagger-ui pre {
          filter: invert(1) hue-rotate(180deg);
        }
      `}</style>
    </div>
  )
}
