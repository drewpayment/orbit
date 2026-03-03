'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface JsonSchemaProperty {
  type: string
  description?: string
  default?: unknown
  enum?: string[]
  minimum?: number
  maximum?: number
}

interface JsonSchema {
  type: 'object'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

interface ParameterFormProps {
  schema: JsonSchema | null | undefined
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
}

export function ParameterForm({ schema, values, onChange }: ParameterFormProps) {
  if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This template has no configurable parameters.
      </p>
    )
  }

  const requiredFields = new Set(schema.required || [])

  function handleChange(key: string, value: unknown) {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(([key, prop]) => {
        const isRequired = requiredFields.has(key)
        const fieldLabel = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/[_-]/g, ' ')
          .replace(/^\w/, (c) => c.toUpperCase())
          .trim()

        if (prop.type === 'boolean') {
          return (
            <div key={key} className="flex items-center space-x-2">
              <Checkbox
                id={`param-${key}`}
                checked={Boolean(values[key] ?? prop.default ?? false)}
                onCheckedChange={(checked) => handleChange(key, checked)}
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor={`param-${key}`}>
                  {fieldLabel}
                  {isRequired && <span className="text-destructive ml-1">*</span>}
                </Label>
                {prop.description && (
                  <p className="text-xs text-muted-foreground">{prop.description}</p>
                )}
              </div>
            </div>
          )
        }

        if (prop.type === 'number' || prop.type === 'integer') {
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={`param-${key}`}>
                {fieldLabel}
                {isRequired && <span className="text-destructive ml-1">*</span>}
              </Label>
              {prop.description && (
                <p className="text-xs text-muted-foreground">{prop.description}</p>
              )}
              <Input
                id={`param-${key}`}
                type="number"
                value={String(values[key] ?? prop.default ?? '')}
                onChange={(e) => handleChange(key, e.target.value ? Number(e.target.value) : '')}
                min={prop.minimum}
                max={prop.maximum}
                required={isRequired}
              />
            </div>
          )
        }

        // Default: text input (string type and fallback)
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={`param-${key}`}>
              {fieldLabel}
              {isRequired && <span className="text-destructive ml-1">*</span>}
            </Label>
            {prop.description && (
              <p className="text-xs text-muted-foreground">{prop.description}</p>
            )}
            <Input
              id={`param-${key}`}
              type="text"
              value={String(values[key] ?? prop.default ?? '')}
              onChange={(e) => handleChange(key, e.target.value)}
              required={isRequired}
            />
          </div>
        )
      })}
    </div>
  )
}
