import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { FileTreeDiff } from './FileTreeDiff'
import type { PlanFileEntry, PlanOtherEntry } from './plan-entries'

afterEach(cleanup)

const files: PlanFileEntry[] = [
  { path: 'src/main.go', change: 'added', detail: null },
  { path: 'README.md', change: 'changed', detail: null },
]

function other(kind: string, name: string, incomplete = false): PlanOtherEntry {
  return { kind, name, description: null, incomplete }
}

describe('FileTreeDiff', () => {
  it('renders the file tree with a per-kind count', () => {
    render(<FileTreeDiff entries={files} />)
    expect(screen.getByText('main.go')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText(/1 added/)).toBeInTheDocument()
    expect(screen.getByText(/1 changed/)).toBeInTheDocument()
  })

  it('says the plan writes no files when there are none', () => {
    render(<FileTreeDiff entries={[]} />)
    expect(screen.getByText(/writes no files/i)).toBeInTheDocument()
  })

  it('renders a non-file planned change generically, by kind and name', () => {
    render(<FileTreeDiff entries={[]} others={[other('repo', 'org/svc')]} />)
    expect(screen.getByText('repo')).toBeInTheDocument()
    expect(screen.getByText('org/svc')).toBeInTheDocument()
  })

  it('renders a kind it has never seen before rather than dropping it', () => {
    render(<FileTreeDiff entries={[]} others={[other('dns-record', 'svc.example.com')]} />)
    expect(screen.getByText('dns-record')).toBeInTheDocument()
    expect(screen.getByText('svc.example.com')).toBeInTheDocument()
  })

  it('shows a description when the planner gave one', () => {
    render(
      <FileTreeDiff
        entries={[]}
        others={[{ kind: 'entity', name: 'svc', description: 'Catalog entity', incomplete: false }]}
      />,
    )
    expect(screen.getByText('Catalog entity')).toBeInTheDocument()
  })

  // The legend also spells out "skipped" and "unsupported", so these assert
  // against the entry row itself rather than the whole panel.
  it('renders a skipped step', () => {
    render(<FileTreeDiff entries={[]} others={[other('skipped', 'create-repo', true)]} />)
    const row = screen.getByText('create-repo').closest('li') as HTMLElement
    expect(within(row).getByText('skipped')).toBeInTheDocument()
  })

  it('renders an unsupported step', () => {
    render(<FileTreeDiff entries={[]} others={[other('unsupported', 'kafka:topic:create', true)]} />)
    const row = screen.getByText('kafka:topic:create').closest('li') as HTMLElement
    expect(within(row).getByText('unsupported')).toBeInTheDocument()
  })

  it('warns that the preview is incomplete when something was skipped or unpreviewable', () => {
    render(
      <FileTreeDiff
        entries={files}
        others={[other('skipped', 'create-repo', true), other('repo', 'org/svc')]}
      />,
    )
    expect(screen.getByRole('note')).toHaveTextContent(/not the whole picture|incomplete/i)
  })

  it('shows no incomplete-preview warning for a fully previewed plan', () => {
    render(<FileTreeDiff entries={files} others={[other('repo', 'org/svc')]} />)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('distinguishes incomplete entries from real planned changes', () => {
    render(
      <FileTreeDiff
        entries={[]}
        others={[other('skipped', 'a', true), other('repo', 'b')]}
      />,
    )
    const skipped = screen.getByText('a').closest('li')
    const real = screen.getByText('b').closest('li')
    expect(skipped?.getAttribute('data-incomplete')).toBe('true')
    expect(real?.getAttribute('data-incomplete')).toBe('false')
  })

  it('renders nothing at all when a plan is entirely empty', () => {
    render(<FileTreeDiff entries={[]} others={[]} />)
    expect(screen.getByText(/writes no files/i)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
