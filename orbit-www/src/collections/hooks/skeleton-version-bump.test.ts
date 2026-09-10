import { describe, it, expect } from 'vitest'
import { skeletonVersionBumpHook } from './skeleton-version-bump'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function args(overrides: Record<string, any>): any {
  return {
    data: {},
    operation: 'create',
    originalDoc: undefined,
    req: { user: { id: 'user-1' } },
    ...overrides,
  }
}

describe('skeletonVersionBumpHook', () => {
  it('sets version 1 and createdBy from the requesting user on create', () => {
    const result = skeletonVersionBumpHook(
      args({ data: { name: 'Foo' }, operation: 'create' }),
    )
    expect(result).toMatchObject({ version: 1, createdBy: 'user-1' })
  })

  it('ignores a client-supplied version on create (always starts at 1)', () => {
    const result = skeletonVersionBumpHook(
      args({ data: { name: 'Foo', version: 999999 }, operation: 'create' }),
    )
    expect(result.version).toBe(1)
  })

  it('bumps version from originalDoc.version on update, ignoring a spoofed data.version', () => {
    const result = skeletonVersionBumpHook(
      args({
        data: { name: 'Foo', version: 999999 },
        operation: 'update',
        originalDoc: { version: 4, createdBy: 'original-user' },
      }),
    )
    expect(result.version).toBe(5)
  })

  it('pins createdBy to originalDoc.createdBy on update, ignoring a spoofed data.createdBy', () => {
    const result = skeletonVersionBumpHook(
      args({
        data: { name: 'Foo', createdBy: 'attacker-user' },
        operation: 'update',
        originalDoc: { version: 1, createdBy: 'original-user' },
      }),
    )
    expect(result.createdBy).toBe('original-user')
  })

  it('treats a missing originalDoc.version as 0 on update (defensive default)', () => {
    const result = skeletonVersionBumpHook(
      args({ data: {}, operation: 'update', originalDoc: { createdBy: 'original-user' } }),
    )
    expect(result.version).toBe(1)
  })

  it('returns data unchanged when data is falsy', () => {
    const result = skeletonVersionBumpHook(args({ data: undefined, operation: 'update' }))
    expect(result).toBeUndefined()
  })
})
