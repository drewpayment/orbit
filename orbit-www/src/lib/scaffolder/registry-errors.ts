/**
 * `RegistryUnavailableError` — split out of `authoring-actions.ts` (a
 * `'use server'` file). Next.js only allows async function exports from a
 * `'use server'` module, so a class export there is a build error (SWC:
 * "Only async functions are allowed to be exported in a 'use server'
 * file."). Kept in its own tiny, framework-free module so it can be a
 * normal class export and imported by both the server-action module and
 * any test/UI code that needs to `instanceof`-check it.
 */

/** Thrown by `listActionRegistry` when the Go worker's ListActions RPC fails — distinguishes "registry down" from a genuine validation failure. */
export class RegistryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The action registry is temporarily unavailable (${cause instanceof Error ? cause.message : String(cause)}). Try validating again shortly.`,
    )
    this.name = 'RegistryUnavailableError'
  }
}
