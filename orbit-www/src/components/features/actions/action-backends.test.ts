import { describe, it, expect } from 'vitest'
import {
  ACTION_BACKEND_TYPES,
  BACKEND_TYPE_META,
  AUTHORABLE_BACKEND_TYPE_OPTIONS,
} from './action-backends'

describe('action-backends', () => {
  it('scaffolder is registered but marked not authorable (BLOCKER 1: hidden runner rows only)', () => {
    expect(ACTION_BACKEND_TYPES).toContain('scaffolder')
    expect(BACKEND_TYPE_META.scaffolder.authorable).toBe(false)
  })

  it('every OTHER backend type defaults to authorable: true', () => {
    for (const type of ACTION_BACKEND_TYPES) {
      if (type === 'scaffolder') continue
      expect(BACKEND_TYPE_META[type].authorable).not.toBe(false)
    }
  })

  it('AUTHORABLE_BACKEND_TYPE_OPTIONS excludes scaffolder', () => {
    expect(AUTHORABLE_BACKEND_TYPE_OPTIONS.map((o) => o.value)).not.toContain('scaffolder')
    // ...but does include everything else, so this doesn't silently hide unrelated types.
    expect(AUTHORABLE_BACKEND_TYPE_OPTIONS).toHaveLength(ACTION_BACKEND_TYPES.length - 1)
  })
})
