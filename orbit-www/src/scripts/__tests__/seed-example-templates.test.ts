import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rewritePlaceholders,
  dirToSkeletonFiles,
  hasContentChanged,
} from '../seed-example-templates-lib'

describe('rewritePlaceholders', () => {
  it('replaces skeleton and template placeholders with resolved ids', () => {
    const result = rewritePlaceholders({
      text: 'skeletonId: ${skeleton:go-http-service}\ntemplateDefinitionId: ${template:go-http-service}',
      skeletonIds: { 'go-http-service': 'skel-1' },
      templateIds: { 'go-http-service': 'tpl-1' },
    })
    expect(result.text).toBe('skeletonId: skel-1\ntemplateDefinitionId: tpl-1')
    expect(result.unresolved).toEqual([])
  })

  it('replaces every occurrence of a repeated placeholder', () => {
    const result = rewritePlaceholders({
      text: 'a: ${skeleton:go-http-service}\nb: ${skeleton:go-http-service}',
      skeletonIds: { 'go-http-service': 'skel-1' },
      templateIds: {},
    })
    expect(result.text).toBe('a: skel-1\nb: skel-1')
  })

  it('replaces the installation placeholder when installationId is given', () => {
    const result = rewritePlaceholders({
      text: 'installationId: ${installation}',
      skeletonIds: {},
      templateIds: {},
      installationId: '118088915',
    })
    expect(result.text).toBe('installationId: 118088915')
    expect(result.unresolved).toEqual([])
  })

  it('leaves the installation placeholder untouched when no installationId is given', () => {
    const result = rewritePlaceholders({
      text: 'installationId: ${installation}',
      skeletonIds: {},
      templateIds: {},
    })
    expect(result.text).toBe('installationId: ${installation}')
    expect(result.unresolved).toEqual([])
  })

  it('reports an unresolved skeleton placeholder and leaves it untouched', () => {
    const result = rewritePlaceholders({
      text: 'skeletonId: ${skeleton:does-not-exist}',
      skeletonIds: { 'go-http-service': 'skel-1' },
      templateIds: {},
    })
    expect(result.text).toBe('skeletonId: ${skeleton:does-not-exist}')
    expect(result.unresolved).toEqual(['skeleton:does-not-exist'])
  })

  it('reports an unresolved template placeholder and leaves it untouched', () => {
    const result = rewritePlaceholders({
      text: 'templateDefinitionId: ${template:does-not-exist}',
      skeletonIds: {},
      templateIds: { 'go-http-service': 'tpl-1' },
    })
    expect(result.text).toBe('templateDefinitionId: ${template:does-not-exist}')
    expect(result.unresolved).toEqual(['template:does-not-exist'])
  })

  it('collects multiple unresolved placeholders of different kinds', () => {
    const result = rewritePlaceholders({
      text: '${skeleton:missing-a} ${template:missing-b}',
      skeletonIds: {},
      templateIds: {},
    })
    expect(result.unresolved).toEqual(['skeleton:missing-a', 'template:missing-b'])
  })

  it('is a no-op on text with no placeholders', () => {
    const result = rewritePlaceholders({
      text: 'apiVersion: orbit/v2\nkind: Template',
      skeletonIds: {},
      templateIds: {},
    })
    expect(result.text).toBe('apiVersion: orbit/v2\nkind: Template')
    expect(result.unresolved).toEqual([])
  })
})

describe('dirToSkeletonFiles', () => {
  function makeTempSkeletonDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'seed-example-templates-'))
    writeFileSync(join(dir, 'orbit-template.yaml'), 'rawFiles:\n  - .github/workflows/ci.yml\n')
    writeFileSync(join(dir, 'go.mod'), 'module example\n')
    mkdirSync(join(dir, 'internal', 'server'), { recursive: true })
    writeFileSync(join(dir, 'internal', 'server', 'server.go'), 'package server\n')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
    return dir
  }

  it('includes orbit-template.yaml as a regular bundle file', () => {
    const dir = makeTempSkeletonDir()
    try {
      const files = dirToSkeletonFiles(dir)
      const paths = files.map((f) => f.path)
      expect(paths).toContain('orbit-template.yaml')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('converts nested directories into forward-slash relative paths', () => {
    const dir = makeTempSkeletonDir()
    try {
      const files = dirToSkeletonFiles(dir)
      const paths = files.map((f) => f.path)
      expect(paths).toContain('internal/server/server.go')
      expect(paths).toContain('.github/workflows/ci.yml')
      expect(paths.some((p) => p.includes('\\'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns file contents verbatim', () => {
    const dir = makeTempSkeletonDir()
    try {
      const files = dirToSkeletonFiles(dir)
      const goMod = files.find((f) => f.path === 'go.mod')
      expect(goMod?.content).toBe('module example\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns paths sorted deterministically', () => {
    const dir = makeTempSkeletonDir()
    try {
      const files = dirToSkeletonFiles(dir)
      const paths = files.map((f) => f.path)
      const sorted = [...paths].sort((a, b) => a.localeCompare(b))
      expect(paths).toEqual(sorted)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('hasContentChanged', () => {
  it('reports no change for identical objects', () => {
    expect(hasContentChanged({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(false)
  })

  it('reports no change when key order differs', () => {
    expect(hasContentChanged({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
  })

  it('reports a change when a value differs', () => {
    expect(hasContentChanged({ a: 1 }, { a: 2 })).toBe(true)
  })

  it('reports a change when a key is added or removed', () => {
    expect(hasContentChanged({ a: 1 }, { a: 1, b: 2 })).toBe(true)
  })

  it('reports no change for identical file-list arrays regardless of nested key order', () => {
    const a = [{ path: 'go.mod', content: 'x' }]
    const b = [{ content: 'x', path: 'go.mod' }]
    expect(hasContentChanged(a, b)).toBe(false)
  })
})
