import { describe, it, expect } from 'vitest'
import { languageForPath } from './skeleton-editor-lang'

describe('languageForPath', () => {
  it('maps common extensions to Monaco language ids', () => {
    expect(languageForPath('config.yaml')).toBe('yaml')
    expect(languageForPath('config.yml')).toBe('yaml')
    expect(languageForPath('package.json')).toBe('json')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('src/index.ts')).toBe('typescript')
    expect(languageForPath('src/index.tsx')).toBe('typescript')
    expect(languageForPath('src/index.js')).toBe('javascript')
    expect(languageForPath('src/index.jsx')).toBe('javascript')
    expect(languageForPath('main.go')).toBe('go')
    expect(languageForPath('script.py')).toBe('python')
    expect(languageForPath('run.sh')).toBe('shell')
    expect(languageForPath('index.html')).toBe('html')
    expect(languageForPath('style.css')).toBe('css')
  })

  it('matches Dockerfile by filename, case-insensitively', () => {
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('build/Dockerfile')).toBe('dockerfile')
    expect(languageForPath('dockerfile')).toBe('dockerfile')
  })

  it('defaults to plaintext for unknown extensions', () => {
    expect(languageForPath('data.bin')).toBe('plaintext')
    expect(languageForPath('noextension')).toBe('plaintext')
  })

  it('never throws on empty or malformed input', () => {
    expect(languageForPath('')).toBe('plaintext')
    expect(languageForPath('.')).toBe('plaintext')
    expect(languageForPath('..')).toBe('plaintext')
  })
})
