import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SkeletonEditorShell } from './SkeletonEditorShell'
import type { SkeletonDetail } from '@/app/(frontend)/self-service/templates/skeletons/skeleton-actions'

// Same mocking convention as YamlView.test.tsx: a plain textarea standing in
// for the Monaco editor, exposing `value`/`onChange`/`language` via props.
function MockMonacoEditor({
  value,
  onChange,
  language,
}: {
  value: string
  onChange: (v: string | undefined) => void
  language?: string
}) {
  return (
    <textarea
      data-testid="skeleton-file-editor"
      data-language={language}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

vi.mock('@monaco-editor/react', () => ({ default: MockMonacoEditor }))

const pushMock = vi.fn()
const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function existingSkeleton(): SkeletonDetail {
  return {
    id: 'skel-1',
    workspaceId: 'ws-1',
    name: 'Go service',
    slug: 'go-service',
    description: 'A starter Go service',
    files: [
      { path: 'main.go', content: 'package main' },
      { path: 'README.md', content: '# Go service' },
    ],
    version: 1,
    totalSize: 40,
  }
}

describe('SkeletonEditorShell', () => {
  it('renders existing metadata and the file tree in edit mode', () => {
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    expect(screen.getByDisplayValue('Go service')).toBeInTheDocument()
    expect(screen.getByDisplayValue('go-service')).toBeInTheDocument()
    expect(screen.getByText('main.go')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('shows the {{ }} vs ${{ }} delimiter hint copy', () => {
    render(
      <SkeletonEditorShell
        mode="create"
        workspaceId="ws-1"
        skeleton={null}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    expect(screen.getByTestId('skeleton-hint-syntax')).toHaveTextContent(/\{\{\s*\.key\s*\}\}/)
    expect(screen.getByTestId('skeleton-hint-warning')).toHaveTextContent(/not.*\$\{\{/i)
  })

  it('selecting a file loads its content into the editor', () => {
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.click(screen.getByText('README.md'))
    expect(screen.getByTestId('skeleton-file-editor')).toHaveValue('# Go service')
    expect(screen.getByTestId('skeleton-file-editor')).toHaveAttribute('data-language', 'markdown')
  })

  it('editing the selected file content updates state and the counters', () => {
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.click(screen.getByText('main.go'))
    fireEvent.change(screen.getByTestId('skeleton-file-editor'), {
      target: { value: 'package main\n\nfunc main() {}' },
    })
    expect(screen.getByTestId('skeleton-file-editor')).toHaveValue('package main\n\nfunc main() {}')
  })

  it('adds a new file via the add-file input and selects it', () => {
    render(
      <SkeletonEditorShell
        mode="create"
        workspaceId="ws-1"
        skeleton={null}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new file path/i), { target: { value: 'src/index.ts' } })
    fireEvent.click(screen.getByRole('button', { name: /add file/i }))
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByTestId('skeleton-file-editor')).toHaveValue('')
  })

  it('renames a file, updating its path', () => {
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.click(screen.getByText('main.go'))
    fireEvent.click(screen.getByRole('button', { name: /rename main\.go/i }))
    const renameInput = screen.getByDisplayValue('main.go')
    fireEvent.change(renameInput, { target: { value: 'cmd/main.go' } })
    fireEvent.submit(renameInput.closest('form') as HTMLFormElement)
    expect(screen.getByText('main.go')).toBeInTheDocument()
    expect(screen.queryAllByText('cmd').length).toBeGreaterThan(0)
  })

  it('deletes a file from the tree', () => {
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /delete readme\.md/i }))
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
  })

  it('disables Save with an explanatory message when the file count exceeds the cap', () => {
    const files = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' }))
    const skeleton: SkeletonDetail = { ...existingSkeleton(), files }
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.getByText(/at most 50 files/i)).toBeInTheDocument()
    expect(screen.getAllByText(/git/i).length).toBeGreaterThan(0)
  })

  it('disables Save with an explanatory message when total size exceeds the 1000 KB cap', () => {
    const big = 'a'.repeat(1_000_001)
    const skeleton: SkeletonDetail = { ...existingSkeleton(), files: [{ path: 'big.txt', content: big }] }
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.getByText(/1,?000,?000 bytes|1 ?MB/i)).toBeInTheDocument()
  })

  it('disables Save and shows an error for a path-traversal file path', () => {
    const skeleton: SkeletonDetail = {
      ...existingSkeleton(),
      files: [{ path: '../evil.txt', content: 'x' }],
    }
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.getAllByText(/\.\./).length).toBeGreaterThan(0)
  })

  it('calls createSkeleton with the current form state and redirects on success in create mode', async () => {
    const createSkeleton = vi.fn().mockResolvedValue({ ok: true, data: { id: 'new-skel' } })
    render(
      <SkeletonEditorShell
        mode="create"
        workspaceId="ws-1"
        skeleton={null}
        actions={{ createSkeleton, saveSkeleton: vi.fn() }}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'My skeleton' } })
    fireEvent.change(screen.getByLabelText(/new file path/i), { target: { value: 'a.txt' } })
    fireEvent.click(screen.getByRole('button', { name: /add file/i }))

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(createSkeleton).toHaveBeenCalledTimes(1))
    expect(createSkeleton).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        name: 'My skeleton',
        slug: 'my-skeleton',
        files: [{ path: 'a.txt', content: '' }],
      }),
    )
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/self-service/templates/skeletons/new-skel/edit'))
  })

  it('calls saveSkeleton with the skeleton id in edit mode and surfaces server errors', async () => {
    const saveSkeleton = vi.fn().mockResolvedValue({ ok: false, errors: ['Duplicate file path "main.go".'] })
    const skeleton = existingSkeleton()
    render(
      <SkeletonEditorShell
        mode="edit"
        workspaceId="ws-1"
        skeleton={skeleton}
        actions={{ createSkeleton: vi.fn(), saveSkeleton }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(saveSkeleton).toHaveBeenCalledWith('skel-1', expect.objectContaining({ slug: 'go-service' })))
    expect(await screen.findByText(/Duplicate file path/i)).toBeInTheDocument()
  })
})
