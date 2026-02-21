import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SyncStatusBadge } from './SyncStatusBadge'

describe('SyncStatusBadge', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders "Not synced" when syncEnabled is false', () => {
    render(<SyncStatusBadge syncEnabled={false} conflictDetected={false} />)
    expect(screen.getByText('Not synced')).toBeInTheDocument()
  })

  it('renders "Synced" when syncEnabled is true and no conflict', () => {
    render(<SyncStatusBadge syncEnabled={true} conflictDetected={false} />)
    expect(screen.getByText('Synced')).toBeInTheDocument()
  })

  it('renders "Conflict" when conflictDetected is true', () => {
    render(<SyncStatusBadge syncEnabled={true} conflictDetected={true} />)
    expect(screen.getByText('Conflict')).toBeInTheDocument()
  })

  it('shows lastSyncAt when provided and synced', () => {
    render(
      <SyncStatusBadge
        syncEnabled={true}
        conflictDetected={false}
        lastSyncAt="2026-02-14T12:00:00Z"
      />,
    )
    expect(screen.getByText('Synced')).toBeInTheDocument()
  })
})
