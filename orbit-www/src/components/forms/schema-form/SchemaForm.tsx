/**
 * `SchemaForm` — the one form engine for JSON-Schema-described parameters
 * (Template Authoring Phase 2, architecture decision #1). Converts each
 * page's schema to zod (`schema-to-zod.ts`), wires `react-hook-form` +
 * shadcn's `form.tsx` wrapper, evaluates `ui:visibleIf` (`visible-if.ts`) to
 * hide/unregister fields, and resolves each leaf field to a component via
 * the field registry (`field-registry.tsx`). An `object`-typed property with
 * explicit `properties` recurses into a nested `SchemaForm`; a free-form
 * `{ key: value }` map (`isKeyValueObjectSchema` — no fixed `properties`)
 * instead resolves through the field registry like any other leaf, to
 * `KeyValueObjectField`.
 *
 * Hidden fields are unregistered from validation (not just visually hidden):
 * the zod schema used for a given submit/validate pass only covers the
 * currently-visible property names, so a required-but-hidden field never
 * produces a phantom error.
 */
'use client'

import * as React from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { jsonSchemaToZod } from './schema-to-zod'
import { evaluateVisibleIf } from './visible-if'
import { defaultFieldRegistry, isKeyValueObjectSchema, type FieldRegistry } from './field-registry'
import type { JsonSchema, SchemaFormPage, UiFieldSchema, UiSchema } from './types'
import { applyParameterDefaults } from '@/lib/scaffolder/defaults'

export interface SchemaFormProps {
  pages: SchemaFormPage[]
  values?: Record<string, unknown>
  onChange?: (values: Record<string, unknown>) => void
  onSubmit?: (values: Record<string, unknown>) => void
  fieldRegistry?: FieldRegistry
  mode?: 'wizard' | 'single'
  /** Hide the built-in submit button (e.g. an embedded read-only preview). */
  hideSubmit?: boolean
  submitLabel?: string
  /**
   * `id` on the rendered `<form>` — lets a caller place a submit button
   * elsewhere in the DOM (e.g. a dialog footer) via `<button form={id}>`
   * while still hiding SchemaForm's own submit button with `hideSubmit`.
   */
  id?: string
  /**
   * Render as a `<div>` instead of a `<form>` — for embedding SchemaForm's
   * fields inside a caller-owned `<form>` (HTML forbids nested `<form>`s).
   * Implies no submit button/handler of its own; the caller reads live
   * values via `onChange` and owns the actual submit. Defaults to `'form'`.
   */
  as?: 'form' | 'div'
}

interface FieldEntry {
  name: string
  schema: JsonSchema
  uiSchema?: UiFieldSchema
}

function orderedFieldNames(schema: JsonSchema, uiSchema?: UiSchema): string[] {
  const propertyNames = Object.keys(schema.properties ?? {})
  const order = uiSchema?.['ui:order']
  if (!order) return propertyNames

  const seen = new Set<string>()
  const result: string[] = []
  for (const name of order) {
    if (name === '*') continue
    if (propertyNames.includes(name) && !seen.has(name)) {
      result.push(name)
      seen.add(name)
    }
  }
  const hasWildcard = order.includes('*')
  const rest = propertyNames.filter((n) => !seen.has(n))
  return hasWildcard || order.length === 0 ? [...result, ...rest] : result.length > 0 ? result : propertyNames
}

function fieldEntries(schema: JsonSchema, uiSchema?: UiSchema): FieldEntry[] {
  const properties = schema.properties ?? {}
  return orderedFieldNames(schema, uiSchema).map((name) => ({
    name,
    schema: properties[name],
    uiSchema: uiSchema?.[name] as UiFieldSchema | undefined,
  }))
}

/** Merge all pages' object schemas into one flat schema (unique property names assumed). */
function mergePages(pages: SchemaFormPage[]): { schema: JsonSchema; uiSchema: UiSchema } {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const uiSchema: UiSchema = {}
  for (const page of pages) {
    Object.assign(properties, page.schema.properties ?? {})
    required.push(...(page.schema.required ?? []))
    if (page.uiSchema) Object.assign(uiSchema, page.uiSchema)
  }
  return { schema: { type: 'object', properties, required }, uiSchema }
}

/** Build a zod object schema covering only `visibleNames`. */
function zodForVisible(schema: JsonSchema, visibleNames: Set<string>): z.ZodTypeAny {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const filtered: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]) => visibleNames.has(name)),
    ),
    required: (schema.required ?? []).filter((name) => visibleNames.has(name) && required.has(name)),
  }
  return jsonSchemaToZod(filtered).and(z.record(z.string(), z.unknown()))
}

function computeVisible(
  entries: FieldEntry[],
  values: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>()
  for (const entry of entries) {
    if (evaluateVisibleIf(entry.uiSchema?.['ui:visibleIf'], values)) visible.add(entry.name)
  }
  return visible
}

/**
 * Wrap `ui:secret` fields' values as `{ value, secret: true }` on emit —
 * recurses into nested `object` properties so a secret field inside a
 * grouped/nested schema is redacted too, not just top-level fields.
 */
function applySecretFlags(
  values: Record<string, unknown>,
  schema: JsonSchema,
  uiSchema?: UiSchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values }
  for (const entry of fieldEntries(schema, uiSchema)) {
    const current = out[entry.name]
    if (entry.schema?.type === 'object' && current && typeof current === 'object') {
      out[entry.name] = applySecretFlags(
        current as Record<string, unknown>,
        entry.schema,
        undefined,
      )
    } else if (entry.uiSchema?.['ui:secret'] && typeof current === 'string') {
      out[entry.name] = { value: current, secret: true as const }
    }
  }
  return out
}

export function SchemaForm({
  pages,
  values,
  onChange,
  onSubmit,
  fieldRegistry = defaultFieldRegistry,
  mode = pages.length > 1 ? 'wizard' : 'single',
  hideSubmit = false,
  submitLabel = 'Submit',
  id,
  as = 'form',
}: SchemaFormProps) {
  const { schema: mergedSchema, uiSchema: mergedUiSchema } = React.useMemo(
    () => mergePages(pages),
    [pages],
  )
  const entries = React.useMemo(
    () => fieldEntries(mergedSchema, mergedUiSchema),
    [mergedSchema, mergedUiSchema],
  )
  const entriesByName = React.useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries])

  const resolver = React.useCallback<Resolver<Record<string, unknown>>>(
    async (formValues, context, options) => {
      const visible = computeVisible(entries, formValues)
      const schema = zodForVisible(mergedSchema, visible)
      // zodResolver's generic `FieldValues` inference doesn't line up with our
      // dynamically-narrowed-per-page-visibility schema; the runtime contract
      // (parse → RHF resolver result shape) is exercised by SchemaForm.test.tsx.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zodResolve = zodResolver(schema as any) as unknown as Resolver<Record<string, unknown>>
      return zodResolve(formValues, context, options)
    },
    [entries, mergedSchema],
  )

  const initialValues = React.useMemo(
    // `applyParameterDefaults` — shared with the server's authoritative
    // defaulting (`lib/scaffolder/defaults.ts`, mirrored by the Go
    // engine's `ApplyParameterDefaults`) — takes `{ properties }` pages;
    // `mergedSchema.properties` (already merged across every form page) is
    // passed as the single page it needs.
    () => applyParameterDefaults([{ properties: mergedSchema.properties }], values ?? {}),
    // Intentionally computed once for RHF's `defaultValues` (initial mount
    // only) — re-deriving per keystroke would fight the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const form = useForm<Record<string, unknown>>({
    resolver,
    defaultValues: initialValues,
    mode: 'onSubmit',
  })

  const watched = form.watch()
  const visibleNames = computeVisible(entries, watched)

  React.useEffect(() => {
    if (onChange) onChange(form.getValues())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(watched)])

  const [activePage, setActivePage] = React.useState(0)
  const pagesToRender = mode === 'wizard' ? pages : [{ title: pages[0]?.title ?? '', schema: mergedSchema, uiSchema: mergedUiSchema }]

  /**
   * Strip hidden (visibleIf=false) fields' values from the submitted
   * payload — they are already excluded from validation (`zodForVisible`),
   * so a stale/leftover value from before a field was hidden should not
   * silently ship either. Mirrors the server-side validator (PR #102),
   * which also drops `required` for hidden fields.
   */
  function stripHiddenFieldValues(formValues: Record<string, unknown>): Record<string, unknown> {
    const visible = computeVisible(entries, formValues)
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(formValues)) {
      if (entriesByName.has(key) && !visible.has(key)) continue
      out[key] = val
    }
    return out
  }

  function handleSubmit(formValues: Record<string, unknown>) {
    const stripped = stripHiddenFieldValues(formValues)
    onSubmit?.(applySecretFlags(stripped, mergedSchema, mergedUiSchema))
  }

  /** Which wizard page (index) owns a given top-level field name, if any. */
  function pageIndexForField(fieldName: string): number {
    return pages.findIndex((page) =>
      fieldEntries(page.schema, page.uiSchema).some((e) => e.name === fieldName),
    )
  }

  /**
   * react-hook-form's `handleSubmit` onInvalid callback: when final submit
   * validation fails, jump the wizard to the first page that owns an
   * errored field so the message is actually visible (a page tab click can
   * navigate straight to a later page without validating earlier ones).
   */
  function handleInvalid(errors: FieldErrors) {
    if (mode !== 'wizard' || pages.length <= 1) return
    for (const fieldName of Object.keys(errors)) {
      const pageIndex = pageIndexForField(fieldName)
      if (pageIndex !== -1) {
        setActivePage(pageIndex)
        return
      }
    }
  }

  /**
   * Wizard "Next": validates only the active page's fields via
   * `form.trigger`, and blocks advancing on error — hidden fields on that
   * page are excluded from the resolver's schema already, so they can never
   * block Next.
   */
  async function handleNext() {
    const page = pages[activePage]
    if (!page) return
    const fieldNames = fieldEntries(page.schema, page.uiSchema).map((e) => e.name)
    const valid = fieldNames.length === 0 ? true : await form.trigger(fieldNames)
    if (valid) setActivePage((p) => p + 1)
  }

  const Tag = as === 'div' ? 'div' : 'form'
  const tagProps =
    as === 'div'
      ? { className: 'space-y-6' }
      : { id, onSubmit: form.handleSubmit(handleSubmit, handleInvalid), className: 'space-y-6' }

  return (
    <Form {...form}>
      <Tag {...tagProps}>
        {mode === 'wizard' && pages.length > 1 && (
          <div className="flex gap-2 border-b pb-2">
            {pages.map((page, i) => (
              <button
                type="button"
                key={page.title + i}
                onClick={() => setActivePage(i)}
                className={
                  i === activePage
                    ? 'border-b-2 border-primary px-2 pb-1 text-sm font-medium'
                    : 'px-2 pb-1 text-sm text-muted-foreground'
                }
              >
                {page.title}
              </button>
            ))}
          </div>
        )}

        {(mode === 'wizard' ? [pages[activePage]] : pagesToRender)
          .filter((p): p is SchemaFormPage => !!p)
          .map((page, pageIdx) => (
            <div key={page.title + pageIdx} className="space-y-4">
              {fieldEntries(page.schema, page.uiSchema)
                .filter((entry) => entriesByName.has(entry.name) && visibleNames.has(entry.name))
                .map((entry) => {
                  const FieldComponent = fieldRegistry.resolve(entry.schema, entry.uiSchema)
                  const label = entry.schema.title ?? entry.name
                  const required = (mergedSchema.required ?? []).includes(entry.name)

                  if (entry.schema.type === 'object' && !isKeyValueObjectSchema(entry.schema)) {
                    // Not wrapped in <FormField>/<FormItem> (no single RHF
                    // field name applies to a whole group) — use a plain
                    // <Label> rather than <FormLabel>, which requires that
                    // context and would otherwise render a dangling
                    // `htmlFor="undefined-form-item"`.
                    //
                    // KNOWN LIMITATION: nested object properties don't yet
                    // receive a uiSchema (the ui: vocabulary — visibleIf,
                    // widget, secret, order — only applies to top-level
                    // fields today). A field nested inside a group can't be
                    // marked `ui:secret` and therefore isn't redacted by
                    // applySecretFlags below. Flagged as a follow-up; no
                    // template UI in this repo authors nested object
                    // properties yet (UseTemplateForm/RunActionDialog are
                    // both flat schemas).
                    return (
                      <div key={entry.name} className="space-y-2 rounded-md border p-4">
                        <Label>{label}</Label>
                        <SchemaForm
                          pages={[{ title: label, schema: entry.schema }]}
                          values={(watched[entry.name] as Record<string, unknown>) ?? {}}
                          onChange={(v) => form.setValue(entry.name, v)}
                          fieldRegistry={fieldRegistry}
                          hideSubmit
                          mode="single"
                          as="div"
                        />
                      </div>
                    )
                  }

                  return (
                    <FormField
                      key={entry.name}
                      control={form.control}
                      name={entry.name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {label}
                            {required && <span className="ml-0.5 text-destructive">*</span>}
                          </FormLabel>
                          {/*
                            FormControl (a Radix Slot) injects its own
                            useId()-scoped id/aria-describedby/aria-invalid
                            onto FieldComponent — do NOT pass an explicit
                            `id` here. `id={field.name}` previously meant two
                            SchemaForm instances rendering the same field name
                            emitted duplicate DOM ids; FormControl's id is
                            unique per FormItem instance regardless of field
                            name reuse.
                          */}
                          <FormControl>
                            <FieldComponent
                              schema={entry.schema}
                              uiSchema={entry.uiSchema}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                            />
                          </FormControl>
                          {entry.uiSchema?.['ui:help'] && (
                            <FormDescription>{entry.uiSchema['ui:help']}</FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )
                })}
            </div>
          ))}

        {!hideSubmit && as === 'form' && (
          <div className="flex justify-end gap-2">
            {mode === 'wizard' && pages.length > 1 && activePage > 0 && (
              <Button type="button" variant="outline" onClick={() => setActivePage((p) => p - 1)}>
                Back
              </Button>
            )}
            {mode === 'wizard' && pages.length > 1 && activePage < pages.length - 1 ? (
              <Button type="button" onClick={handleNext}>
                Next
              </Button>
            ) : (
              <Button type="submit">{submitLabel}</Button>
            )}
          </div>
        )}
      </Tag>
    </Form>
  )
}

/** Re-export for callers building custom field-error summaries. */
export type SchemaFormFieldErrors = FieldErrors
