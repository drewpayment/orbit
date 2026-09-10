import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { VersionsPanel, type VersionRow } from './VersionsPanel'

afterEach(cleanup)

function version(n: number, extra: Partial<VersionRow> = {}): VersionRow {
  return {
    id: `v${n}`,
    versionNumber: n,
    changeNote: null,
    validatedAt: null,
    dryRunRunId: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    isCurrent: false,
    definitionJson: { metadata: { title: `Title ${n}` } },
    ...extra,
  }
}

describe('VersionsPanel', () => {
  it('shows an empty state with no versions', () => {
    render(<VersionsPanel versions={[]} />)
    expect(screen.getByText(/no versions yet/i)).toBeInTheDocument()
  })

  it('hides the compare controls when there is only one version', () => {
    render(<VersionsPanel versions={[version(1, { isCurrent: true })]} />)
    expect(screen.queryByLabelText('Compare from')).not.toBeInTheDocument()
  })

  it('defaults to comparing the newest version against the one before it', () => {
    // Newest first, as listTemplateDefinitionVersions returns them.
    render(<VersionsPanel versions={[version(3, { isCurrent: true }), version(2), version(1)]} />)
    expect(screen.getByLabelText('Compare from')).toHaveTextContent('v2')
    expect(screen.getByLabelText('Compare to')).toHaveTextContent('v3')
  })

  it('re-defaults when a new version arrives, rather than keeping a stale pair', () => {
    // Mounting with one version and then receiving a second used to leave both
    // selectors pinned to v1, showing "pick two different versions" forever.
    const { rerender } = render(<VersionsPanel versions={[version(1, { isCurrent: true })]} />)
    rerender(<VersionsPanel versions={[version(2, { isCurrent: true }), version(1)]} />)
    expect(screen.getByLabelText('Compare from')).toHaveTextContent('v1')
    expect(screen.getByLabelText('Compare to')).toHaveTextContent('v2')
  })

  it('renders the diff between the two selected versions', () => {
    render(<VersionsPanel versions={[version(2, { isCurrent: true }), version(1)]} />)
    expect(screen.getByText(/-\s*title: Title 1/)).toBeInTheDocument()
    expect(screen.getByText(/\+\s*title: Title 2/)).toBeInTheDocument()
  })

  it('says so when the two versions are identical', () => {
    const same = { metadata: { title: 'Same' } }
    render(
      <VersionsPanel
        versions={[
          version(2, { isCurrent: true, definitionJson: same }),
          version(1, { definitionJson: same }),
        ]}
      />,
    )
    expect(screen.getByText(/identical/i)).toBeInTheDocument()
  })

  it('badges the publish-gate facts on each version', () => {
    render(
      <VersionsPanel
        versions={[version(1, { isCurrent: true, validatedAt: 'now', dryRunRunId: 'run-1' })]}
      />,
    )
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText('Validated')).toBeInTheDocument()
    expect(screen.getByText('Dry run')).toBeInTheDocument()
  })
})
