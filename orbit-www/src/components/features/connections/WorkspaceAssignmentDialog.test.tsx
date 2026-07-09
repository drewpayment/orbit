import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import {
  WorkspaceAssignmentDialog,
  type WorkspaceDialogTarget,
} from './WorkspaceAssignmentDialog'
import { updateInstallationWorkspaces } from '@/app/actions/github-installations'
import { updateConnection } from '@/app/actions/git-connections'

vi.mock('@/app/actions/github-installations', () => ({
  updateInstallationWorkspaces: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/app/actions/git-connections', () => ({
  updateConnection: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const workspaces = [
  { id: 'ws-1', name: 'Platform' },
  { id: 'ws-2', name: 'Payments' },
  { id: 'ws-3', name: 'Growth' },
]

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('WorkspaceAssignmentDialog', () => {
  it('pre-checks the workspaces already assigned to the record', () => {
    const target: WorkspaceDialogTarget = {
      provider: 'github',
      id: 'inst-1',
      name: 'acme-org',
      allowedWorkspaceIds: ['ws-2'],
    }
    render(
      <WorkspaceAssignmentDialog target={target} allWorkspaces={workspaces} onClose={vi.fn()} />,
    )
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[0]).toHaveAttribute('data-state', 'unchecked') // Platform
    expect(boxes[1]).toHaveAttribute('data-state', 'checked') // Payments
    expect(boxes[2]).toHaveAttribute('data-state', 'unchecked') // Growth
  })

  it('persists via the GitHub server action for a github target', async () => {
    const onClose = vi.fn()
    const target: WorkspaceDialogTarget = {
      provider: 'github',
      id: 'inst-1',
      name: 'acme-org',
      allowedWorkspaceIds: ['ws-2'],
    }
    render(
      <WorkspaceAssignmentDialog target={target} allWorkspaces={workspaces} onClose={onClose} />,
    )
    // Toggle Platform on, keeping Payments; result = [ws-2, ws-1].
    fireEvent.click(screen.getByText('Platform'))
    fireEvent.click(screen.getByRole('button', { name: /Save workspaces/i }))

    await waitFor(() => expect(updateInstallationWorkspaces).toHaveBeenCalledTimes(1))
    expect(updateInstallationWorkspaces).toHaveBeenCalledWith('inst-1', ['ws-2', 'ws-1'])
    expect(updateConnection).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('persists via updateConnection for an azure-devops target', async () => {
    const target: WorkspaceDialogTarget = {
      provider: 'azure-devops',
      id: 'conn-1',
      name: 'Acme ADO',
      allowedWorkspaceIds: [],
    }
    render(
      <WorkspaceAssignmentDialog target={target} allWorkspaces={workspaces} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('Growth'))
    fireEvent.click(screen.getByRole('button', { name: /Save workspaces/i }))

    await waitFor(() => expect(updateConnection).toHaveBeenCalledTimes(1))
    expect(updateConnection).toHaveBeenCalledWith({ id: 'conn-1', allowedWorkspaces: ['ws-3'] })
    expect(updateInstallationWorkspaces).not.toHaveBeenCalled()
  })

  it('renders nothing actionable when no target is set (closed)', () => {
    render(
      <WorkspaceAssignmentDialog target={null} allWorkspaces={workspaces} onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
