import { describe, it, expect } from 'vitest'
import { validateSkeletonBundle, MAX_SKELETON_FILES, MAX_SKELETON_TOTAL_BYTES } from './skeleton-bundle'

/**
 * Smoke test for the pure module's own location (the full behavioral suite
 * lives in `orbit-www/src/collections/hooks/validate-skeleton-bundle.test.ts`,
 * which exercises the SAME function via the hook file's re-export). This
 * file exists mainly to prove this module has no `payload` import at all —
 * a `vi.mock('payload', ...)` here would be needed if it did, and this file
 * deliberately has none.
 */
describe('skeleton-bundle (pure, client-safe)', () => {
  it('validates a small bundle with no payload dependency', () => {
    const result = validateSkeletonBundle([{ path: 'a.txt', content: 'hi' }])
    expect(result.ok).toBe(true)
    expect(result.totalSize).toBe(2)
  })

  it('rejects a path-traversal attempt', () => {
    const result = validateSkeletonBundle([{ path: '../evil.txt', content: 'x' }])
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('".." segment')
  })

  it('exposes the file-count and byte-size caps', () => {
    expect(MAX_SKELETON_FILES).toBe(50)
    expect(MAX_SKELETON_TOTAL_BYTES).toBe(1_000_000)
  })

  it('accepts a file with empty content as valid, with size 0', () => {
    const result = validateSkeletonBundle([{ path: '.gitkeep', content: '' }])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.files).toEqual([{ path: '.gitkeep', content: '', size: 0, isBinary: false }])
    expect(result.totalSize).toBe(0)
  })
})
