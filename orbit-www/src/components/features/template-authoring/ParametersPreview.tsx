/**
 * Live parameters preview — Template Authoring Phase 2, Task 10.
 *
 * Renders the current builder pages through the real `SchemaForm` (submit
 * hidden), fed directly from reducer state via `parameterPageToSchemaFormPage`
 * — no YAML/JSON round trip needed since builder state already matches the
 * wire format `SchemaForm`'s adapter understands.
 */
'use client'

import * as React from 'react'
import type { ParameterPage } from '@/lib/scaffolder/schema'
import { SchemaForm } from '@/components/forms/schema-form/SchemaForm'
import { parameterPageToSchemaFormPage } from './schema-ui-split'

export interface ParametersPreviewProps {
  pages: ParameterPage[]
  /** The template definition's own workspace — see `parameterPageToSchemaFormPage`'s doc comment. */
  workspaceId?: string
}

export function ParametersPreview({ pages, workspaceId }: ParametersPreviewProps) {
  const [values, setValues] = React.useState<Record<string, unknown>>({})
  const schemaFormPages = React.useMemo(
    () => pages.map((p) => parameterPageToSchemaFormPage(p, workspaceId)),
    [pages, workspaceId],
  )

  if (schemaFormPages.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a page to see a live preview.</p>
  }

  return (
    <SchemaForm
      pages={schemaFormPages}
      values={values}
      onChange={setValues}
      hideSubmit
      mode={schemaFormPages.length > 1 ? 'wizard' : 'single'}
    />
  )
}
