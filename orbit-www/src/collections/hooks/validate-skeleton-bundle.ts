import type { CollectionBeforeValidateHook } from 'payload'
import { ValidationError } from 'payload'
import {
  MAX_SKELETON_FILES,
  MAX_SKELETON_TOTAL_BYTES,
  validateSkeletonBundle,
  type SkeletonFileInput,
  type SkeletonFileWithSize,
  type ValidateSkeletonBundleResult,
} from '@/lib/scaffolder/skeleton-bundle'

/**
 * `template-skeletons`'s `beforeValidate` hook. The pure validation logic
 * lives in `@/lib/scaffolder/skeleton-bundle.ts` (no `payload` import,
 * safely importable from a client component); this file re-exports that
 * surface for existing importers and adds the Payload-dependent hook on
 * top. Import the pure surface from `@/lib/scaffolder/skeleton-bundle`
 * directly in any NEW code — importing `payload`'s `ValidationError`
 * (which this file needs) pulls Payload's server logger into a client
 * bundle and breaks the build.
 */
export {
  MAX_SKELETON_FILES,
  MAX_SKELETON_TOTAL_BYTES,
  validateSkeletonBundle,
  type SkeletonFileInput,
  type SkeletonFileWithSize,
  type ValidateSkeletonBundleResult,
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
