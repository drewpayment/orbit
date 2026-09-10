/**
 * Shared config surface for the Orbit-native pickers (`OrbitTeamPicker`,
 * `OrbitWorkspacePicker`, `OrbitEntityPicker`, `OrbitRepoPicker`).
 *
 * A `FieldComponent` (see `field-registry.tsx`) only ever receives
 * `{ id, schema, uiSchema, value, onChange, onBlur, disabled }` — there is no
 * channel for a caller to pass e.g. `workspaceId` as a normal React prop
 * through the registry. Orbit pickers read their extra configuration off
 * `uiSchema['ui:options']` (a plain in-memory object — this only works for
 * `uiSchema`s built in JS, not ones round-tripped through JSON; the template
 * authoring shell that builds these schemas at render time). This also gives
 * component tests a clean seam: pass a stub `fetcher` in `ui:options` instead
 * of hitting the real server action.
 */
import type { PickerOption } from '@/app/(frontend)/self-service/templates/picker-data'

export type { PickerOption }

export interface OrbitPickerOptions {
  /** Workspace to scope the picker's data to. Required by every picker except OrbitWorkspacePicker. */
  workspaceId?: string
  /** OrbitEntityPicker only: the catalog entity kind to list. */
  kind?: string
  /** OrbitRepoPicker only: the git-connections id to resolve repos through. */
  connection?: string
  /** OrbitWorkspacePicker only: the caller-resolved list of workspaces (no server lookup here). */
  workspaces?: PickerOption[]
  /** Test/override seam: replaces the default server-action fetch. */
  fetcher?: (...args: string[]) => Promise<PickerOption[]>
  placeholder?: string
}

export function pickerOptions(uiOptions: unknown): OrbitPickerOptions {
  return (uiOptions as OrbitPickerOptions | undefined) ?? {}
}
