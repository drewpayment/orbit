import { vi, describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ManifestConflictBanner } from './ManifestConflictBanner'

// Mock the server action and next/navigation
vi.mock('@/app/actions/apps', () => ({
  resolveManifestConflict: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('ManifestConflictBanner', () => {
  afterEach(cleanup)

  it('renders nothing when no conflict', () => {
    const { container } = render(
      <ManifestConflictBanner conflictDetected={false} appId="123" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders warning when conflict detected', () => {
    render(<ManifestConflictBanner conflictDetected={true} appId="123" />)
    expect(screen.getByText(/sync conflict detected/i)).toBeInTheDocument()
  })

  it('renders both resolution buttons', () => {
    render(<ManifestConflictBanner conflictDetected={true} appId="123" />)
    expect(screen.getByText(/keep orbit/i)).toBeInTheDocument()
    expect(screen.getByText(/keep repository/i)).toBeInTheDocument()
  })
})
