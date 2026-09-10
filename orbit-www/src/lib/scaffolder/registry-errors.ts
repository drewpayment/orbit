/**
 * Error type for the Go action registry lookup.
 *
 * Lives here rather than beside `listActionRegistry` in
 * `self-service/templates/authoring-actions.ts` because that module carries
 * the `'use server'` directive, and Next.js allows a server-action module to
 * export async functions only — exporting a class from it fails the build
 * with "Only async functions are allowed to be exported in a 'use server'
 * file", taking down every route that imports the module.
 */

/**
 * Thrown by `listActionRegistry` when the Go worker's ListActions RPC fails —
 * distinguishes "registry is down" from a genuine validation failure.
 */
export class RegistryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The action registry is temporarily unavailable (${cause instanceof Error ? cause.message : String(cause)}). Try validating again shortly.`,
    )
    this.name = 'RegistryUnavailableError'
  }
}
