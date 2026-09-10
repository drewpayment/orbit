/**
 * Monaco `language` inference from a skeleton file's path (Template
 * Authoring Phase 3, Task 3). Pure, no I/O, safe default (`plaintext`) for
 * anything unrecognized — an unknown extension must never crash the editor
 * pane.
 */

const EXTENSION_LANGUAGE: Record<string, string> = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  go: 'go',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  proto: 'proto',
  toml: 'plaintext',
  xml: 'xml',
}

const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
}

/** Infers a Monaco editor `language` id from a file path. Defaults to `plaintext`. */
export function languageForPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) return 'plaintext'

  const segments = path.split('/')
  const filename = segments[segments.length - 1] ?? ''
  if (!filename) return 'plaintext'

  const byFilename = FILENAME_LANGUAGE[filename.toLowerCase()]
  if (byFilename) return byFilename

  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0) return 'plaintext'

  const ext = filename.slice(dotIndex + 1).toLowerCase()
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext'
}
