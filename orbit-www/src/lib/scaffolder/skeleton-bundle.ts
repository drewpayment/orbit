/**
 * Pure `template-skeletons` bundle validation (plan §2.1) — bundle
 * constraints:
 *  - at most 50 files
 *  - at most 1,000,000 UTF-8 bytes total across all file contents
 *  - every path is relative (no leading `/`), has no `..` segment, no empty
 *    segment, no backslash, and is non-empty
 *  - no duplicate paths
 *
 * Deliberately framework-free — no `payload` import anywhere in this file
 * or its transitive imports. `payload`'s `ValidationError` pulls in
 * Payload's server logger (`pino-pretty`, a Node-only dev dependency),
 * which breaks a client bundle with a "module not found" build error if
 * imported into a `'use client'` component (caught by agent-browser
 * verification for the skeleton authoring UI, Template Authoring Phase 3
 * Task 3). `orbit-www/src/collections/hooks/validate-skeleton-bundle.ts`
 * re-exports this module's pure surface and adds the Payload-dependent
 * `beforeValidate` hook on top — import from HERE, not that file, from any
 * client component.
 */

export const MAX_SKELETON_FILES = 50
export const MAX_SKELETON_TOTAL_BYTES = 1_000_000

export interface SkeletonFileInput {
  path: unknown
  content: unknown
  isBinary?: unknown
}

export interface SkeletonFileWithSize {
  path: string
  content: string
  size: number
  isBinary: false
}

export interface ValidateSkeletonBundleResult {
  ok: boolean
  errors: string[]
  files: SkeletonFileWithSize[]
  totalSize: number
}

function isPathSafe(path: string): string[] {
  const errors: string[] = []
  if (path.length === 0) {
    errors.push('File path must not be empty.')
    return errors
  }
  if (path.startsWith('/')) {
    errors.push(`File path "${path}" must not have a leading /.`)
  }
  if (path.includes('\\')) {
    errors.push(`File path "${path}" must not contain a backslash.`)
  }
  const segments = path.split('/')
  if (segments.some((seg) => seg === '')) {
    errors.push(`File path "${path}" must not contain an empty segment (e.g. a double slash).`)
  }
  if (segments.some((seg) => seg === '..')) {
    errors.push(`File path "${path}" must not contain a ".." segment.`)
  }
  return errors
}

/**
 * UTF-8 byte length of a string. Prefers `Buffer.byteLength` (server-side,
 * marginally faster) and falls back to `TextEncoder` so this module stays
 * safely importable from a `'use client'` component for the authoring UI's
 * client-side pre-check (plan §3.4) — `Buffer` is a Node global that does
 * not exist in a browser bundle.
 */
function utf8ByteLength(value: string): number {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8')
  return new TextEncoder().encode(value).length
}

/**
 * Validates and enriches a skeleton's file list. Pure, no I/O. `content` is
 * measured in UTF-8 bytes (see {@link utf8ByteLength}), not JS string
 * length, so multi-byte characters are counted correctly against the 1 MB
 * cap.
 */
export function validateSkeletonBundle(files: SkeletonFileInput[]): ValidateSkeletonBundleResult {
  const errors: string[] = []

  if (files.length > MAX_SKELETON_FILES) {
    errors.push(`A skeleton may contain at most ${MAX_SKELETON_FILES} files (got ${files.length}).`)
  }

  const seenPaths = new Set<string>()
  const withSizes: SkeletonFileWithSize[] = []
  let totalSize = 0

  for (const raw of files) {
    const path = typeof raw.path === 'string' ? raw.path : ''
    const content = typeof raw.content === 'string' ? raw.content : ''

    errors.push(...isPathSafe(path))

    if (path !== '') {
      if (seenPaths.has(path)) {
        errors.push(`Duplicate file path "${path}".`)
      }
      seenPaths.add(path)
    }

    const size = utf8ByteLength(content)
    totalSize += size

    withSizes.push({ path, content, size, isBinary: false })
  }

  if (totalSize > MAX_SKELETON_TOTAL_BYTES) {
    errors.push(
      `Total bundle size must be at most ${MAX_SKELETON_TOTAL_BYTES.toLocaleString()} bytes (1 MB); got ${totalSize.toLocaleString()} bytes.`,
    )
  }

  return { ok: errors.length === 0, errors, files: withSizes, totalSize }
}
