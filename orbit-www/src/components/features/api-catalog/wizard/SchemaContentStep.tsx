'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { UseFormReturn } from 'react-hook-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, Upload, FileText } from 'lucide-react'
import { validateOpenAPI, type ValidationResult } from '@/lib/schema-validators'
import type { APIFormData } from './BasicInfoStep'

// Dynamically import Monaco Editor
const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading editor...</span>
      </div>
    </div>
  ),
})

interface SchemaContentStepProps {
  form: UseFormReturn<APIFormData>
  validation: ValidationResult
  onValidationChange: (result: ValidationResult) => void
}

const OPENAPI_TEMPLATE = `openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
  description: Describe your API here
  contact:
    name: API Team
    email: api@example.com

servers:
  - url: https://api.example.com/v1
    description: Production server

paths:
  /health:
    get:
      summary: Health check
      operationId: healthCheck
      responses:
        '200':
          description: API is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
`

export function SchemaContentStep({ form, validation, onValidationChange }: SchemaContentStepProps) {
  const content = form.watch('rawContent')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Validate content when it changes
  React.useEffect(() => {
    if (content) {
      const result = validateOpenAPI(content)
      onValidationChange(result)
    } else {
      onValidationChange({ valid: false, errors: [{ message: 'Please provide an OpenAPI specification' }] })
    }
  }, [content, onValidationChange])

  const handleEditorChange = (value: string | undefined) => {
    form.setValue('rawContent', value || '')
  }

  const handleUseTemplate = () => {
    form.setValue('rawContent', OPENAPI_TEMPLATE)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      form.setValue('rawContent', text)
    } catch {
      onValidationChange({
        valid: false,
        errors: [{ message: 'Failed to read file' }],
      })
    }

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenAPI Specification</CardTitle>
        <CardDescription>
          Paste your OpenAPI specification or upload a file. YAML and JSON formats are supported.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUseTemplate}
          >
            <FileText className="mr-2 h-4 w-4" />
            Use Template
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {/* Monaco Editor */}
        <div
          className="border rounded-md overflow-hidden"
          role="region"
          aria-label="OpenAPI specification editor"
        >
          <Editor
            height="400px"
            language="yaml"
            value={content}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        </div>

        {/* Validation feedback */}
        {!validation.valid && validation.errors.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-semibold mb-2">Validation Errors</div>
              <ul className="list-disc list-inside space-y-1">
                {validation.errors.map((error, index) => (
                  <li key={index} className="text-sm">
                    {error.line && `Line ${error.line}: `}
                    {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {validation.valid && content && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <AlertDescription className="text-green-700 dark:text-green-300">
              OpenAPI specification is valid
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
