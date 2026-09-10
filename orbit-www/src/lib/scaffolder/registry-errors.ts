// orbit-www/src/lib/scaffolder/registry-errors.ts

/**
 * Thrown by `listActionRegistry` (`templates/authoring-actions.ts`) when the
 * Go worker's `ListActions` RPC fails — distinguishes "registry down" from a
 * genuine validation failure so callers (e.g. `validateTemplateDefinition`)
 * can report an outage as a typed finding instead of an unhandled
 * rejection.
 *
 * Lives here, NOT in `templates/authoring-actions.ts`, because that file is
 * a `'use server'` module: Next.js's server-actions transform only allows
 * top-level exports to be async functions, and a class export there fails
 * the SWC build for every importer (BUILD BREAK fixed by this move — see
 * the guard test in `authoring-actions.test.ts`). Exact path/name matches
 * what the run-wizard branch already uses locally to avoid a merge
 * conflict.
 */
export class RegistryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The action registry is temporarily unavailable (${cause instanceof Error ? cause.message : String(cause)}). Try validating again shortly.`,
    )
    this.name = 'RegistryUnavailableError'
  }
}
