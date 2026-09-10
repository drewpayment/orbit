import type { CollectionBeforeValidateHook } from 'payload'
import { ValidationError } from 'payload'

/**
 * `template-skeletons` bundle constraints (plan §2.1):
 *  - at most 50 files
 *  - at most 1,000,000 UTF-8 bytes total across all file contents
 *  - every path is relative (no leading `/`), has no `..` segment, no empty
 *    segment, no backslash, and is non-empty
 *  - no duplicate paths
 *
 * This is a plain, framework-free function so it can be unit-tested in
 * isolation from Payload; `validateSkeletonBundleHook` below is the thin
 * `beforeValidate` adapter that wires it into the collection.
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
 * Validates and enriches a skeleton's file list. Pure, no I/O. `content` is
 * measured with `Buffer.byteLength` (UTF-8 bytes), not JS string length, so
 * multi-byte characters are counted correctly against the 1 MB cap.
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

    const size = Buffer.byteLength(content, 'utf8')
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

/**
 * `beforeValidate` hook: runs `validateSkeletonBundle` against `data.files`,
 * throws a Payload `ValidationError` naming every violation when the bundle
 * fails any constraint, and otherwise sets `files[].size`/`isBinary` and
 * `totalSize` on the document from the computed result.
 */
export const validateSkeletonBundleHook: CollectionBeforeValidateHook = async ({ data }) => {
  const files = Array.isArray(data?.files) ? (data.files as SkeletonFileInput[]) : []
  const result = validateSkeletonBundle(files)

  if (!result.ok) {
    throw new ValidationError({
      errors: result.errors.map((message) => ({ path: 'files', message })),
    })
  }

  return {
    ...data,
    files: result.files,
    totalSize: result.totalSize,
  }
}
