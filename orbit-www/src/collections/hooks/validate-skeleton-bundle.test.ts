import { describe, it, expect } from 'vitest'
import { validateSkeletonBundle, type SkeletonFileInput } from './validate-skeleton-bundle'

function file(path: string, content = 'hello'): SkeletonFileInput {
  return { path, content }
}

describe('validateSkeletonBundle', () => {
  it('accepts a small valid bundle and computes sizes', () => {
    const result = validateSkeletonBundle([file('README.md', 'hi'), file('src/index.ts', 'export {}')])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.totalSize).toBe(Buffer.byteLength('hi', 'utf8') + Buffer.byteLength('export {}', 'utf8'))
    expect(result.files).toEqual([
      { path: 'README.md', content: 'hi', size: Buffer.byteLength('hi', 'utf8'), isBinary: false },
      { path: 'src/index.ts', content: 'export {}', size: Buffer.byteLength('export {}', 'utf8'), isBinary: false },
    ])
  })

  it('accepts exactly 50 files', () => {
    const files = Array.from({ length: 50 }, (_, i) => file(`file-${i}.txt`))
    const result = validateSkeletonBundle(files)
    expect(result.ok).toBe(true)
  })

  it('rejects more than 50 files', () => {
    const files = Array.from({ length: 51 }, (_, i) => file(`file-${i}.txt`))
    const result = validateSkeletonBundle(files)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /50/.test(e))).toBe(true)
  })

  it('accepts exactly 1,000,000 bytes total', () => {
    const content = 'a'.repeat(1_000_000)
    const result = validateSkeletonBundle([file('big.txt', content)])
    expect(result.ok).toBe(true)
    expect(result.totalSize).toBe(1_000_000)
  })

  it('rejects a bundle over 1,000,000 bytes total (measured in UTF-8 bytes, not JS string length)', () => {
    // multi-byte chars: string length < byte length
    const content = '€'.repeat(1_000_000) // each euro sign is 3 bytes in utf-8
    const result = validateSkeletonBundle([file('big.txt', content)])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /1,?000,?000|1 ?MB|size/i.test(e))).toBe(true)
  })

  it('rejects an absolute path', () => {
    const result = validateSkeletonBundle([file('/etc/passwd')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /leading \//i.test(e) || /absolute/i.test(e))).toBe(true)
  })

  it('rejects a path with a .. segment', () => {
    const result = validateSkeletonBundle([file('../../etc/passwd')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /\.\./.test(e))).toBe(true)
  })

  it('rejects a path with an embedded .. segment', () => {
    const result = validateSkeletonBundle([file('src/../../etc/passwd')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /\.\./.test(e))).toBe(true)
  })

  it('rejects a path with an empty segment', () => {
    const result = validateSkeletonBundle([file('src//index.ts')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /empty segment/i.test(e))).toBe(true)
  })

  it('rejects a path with a backslash', () => {
    const result = validateSkeletonBundle([file('src\\index.ts')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /backslash/i.test(e))).toBe(true)
  })

  it('rejects an empty path', () => {
    const result = validateSkeletonBundle([file('')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /empty/i.test(e))).toBe(true)
  })

  it('rejects duplicate paths', () => {
    const result = validateSkeletonBundle([file('a.txt', '1'), file('a.txt', '2')])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /duplicate/i.test(e))).toBe(true)
  })

  it('collects multiple errors at once rather than stopping at the first', () => {
    const result = validateSkeletonBundle([file('/abs'), file('../esc'), file('/abs')])
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('handles an empty file list as valid with zero total size', () => {
    const result = validateSkeletonBundle([])
    expect(result.ok).toBe(true)
    expect(result.totalSize).toBe(0)
    expect(result.files).toEqual([])
  })

  it('preserves explicit isBinary: true as always false in v1 (readOnly forward-compat field)', () => {
    const result = validateSkeletonBundle([{ path: 'a.bin', content: 'x', isBinary: true }])
    expect(result.files[0].isBinary).toBe(false)
  })

  it('accepts an empty-content file (e.g. a freshly added file, or .gitkeep) with size 0', () => {
    const result = validateSkeletonBundle([file('.gitkeep', '')])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.files).toEqual([{ path: '.gitkeep', content: '', size: 0, isBinary: false }])
  })
})
