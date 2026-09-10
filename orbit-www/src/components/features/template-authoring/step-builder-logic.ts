/**
 * Pure helpers for `StepsBuilder` (Task 11): registry grouping and step id
 * generation. Kept framework-free so they're unit-testable without React.
 */
import type { ActionDescriptor } from '@/lib/scaffolder/validate'

/** Group the action registry by `family`, preserving registry order within each group. */
export function groupRegistryByFamily(registry: ActionDescriptor[]): Map<string, ActionDescriptor[]> {
  const groups = new Map<string, ActionDescriptor[]>()
  for (const descriptor of registry) {
    const existing = groups.get(descriptor.family)
    if (existing) {
      existing.push(descriptor)
    } else {
      groups.set(descriptor.family, [descriptor])
    }
  }
  return groups
}

/** Legal `${{ steps.<id>.output.* }}` path segment (mirrors `schema.ts`'s `StepSchema.id`). */
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*$/

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return STEP_ID_PATTERN.test(slug) ? slug : slug.replace(/^[^a-z]+/, '') || 'step'
}

/**
 * Generate a unique, legal step id derived from an action id (e.g.
 * `github:repo:create-from-template` → `create-from-template`), avoiding
 * collisions with `existingIds` by appending `-2`, `-3`, …
 */
export function generateStepId(existingIds: string[], actionId: string): string {
  const lastSegment = actionId.split(/[:/]/).pop() ?? actionId
  const base = slugify(lastSegment) || 'step'
  const taken = new Set(existingIds)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
