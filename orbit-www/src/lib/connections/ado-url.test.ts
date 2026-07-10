import { describe, it, expect } from 'vitest'
import { parseAdoRepoUrl, buildAdoRepoUrl } from './ado-url'

describe('parseAdoRepoUrl', () => {
  it('parses a dev.azure.com _git URL', () => {
    expect(parseAdoRepoUrl('https://dev.azure.com/acme/platform/_git/backend')).toEqual({
      organization: 'acme',
      project: 'platform',
      repo: 'backend',
    })
  })

  it('parses an on-prem Azure DevOps Server URL (collection before project)', () => {
    expect(
      parseAdoRepoUrl('https://ado.acme.internal/tfs/DefaultCollection/platform/_git/backend'),
    ).toEqual({
      organization: 'DefaultCollection',
      project: 'platform',
      repo: 'backend',
    })
  })

  it('handles project/repo names with spaces (percent-encoded)', () => {
    expect(parseAdoRepoUrl('https://dev.azure.com/acme/My%20Project/_git/My%20Repo')).toEqual({
      organization: 'acme',
      project: 'My Project',
      repo: 'My Repo',
    })
  })

  it('strips a trailing .git suffix from the repo', () => {
    expect(parseAdoRepoUrl('https://dev.azure.com/acme/platform/_git/backend.git')).toMatchObject({
      repo: 'backend',
    })
  })

  it('returns null for a GitHub URL', () => {
    expect(parseAdoRepoUrl('https://github.com/acme/backend')).toBeNull()
  })

  it('returns null when there is no _git segment', () => {
    expect(parseAdoRepoUrl('https://dev.azure.com/acme/platform/backend')).toBeNull()
  })

  it('returns null when org/project are missing before _git', () => {
    expect(parseAdoRepoUrl('https://dev.azure.com/_git/backend')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(parseAdoRepoUrl('not a url')).toBeNull()
  })
})

describe('buildAdoRepoUrl', () => {
  it('builds a dev.azure.com clone URL', () => {
    expect(buildAdoRepoUrl('https://dev.azure.com', 'acme', 'platform', 'backend')).toBe(
      'https://dev.azure.com/acme/platform/_git/backend',
    )
  })

  it('trims a trailing slash from the base URL', () => {
    expect(buildAdoRepoUrl('https://dev.azure.com/', 'acme', 'platform', 'backend')).toBe(
      'https://dev.azure.com/acme/platform/_git/backend',
    )
  })

  it('honours an on-prem base URL (collection carried as the org segment)', () => {
    expect(
      buildAdoRepoUrl('https://ado.acme.internal/tfs', 'DefaultCollection', 'platform', 'backend'),
    ).toBe('https://ado.acme.internal/tfs/DefaultCollection/platform/_git/backend')
  })
})
