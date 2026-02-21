import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportManifestButton } from './ExportManifestButton'

vi.mock('@/app/actions/apps', () => ({
  exportAppManifest: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('ExportManifestButton', () => {
  it('renders nothing when syncEnabled is true', () => {
    const { container } = render(
      <ExportManifestButton appId="123" syncEnabled={true} hasRepository={true} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when app has no repository', () => {
    const { container } = render(
      <ExportManifestButton appId="123" syncEnabled={false} hasRepository={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders export button when sync is off and has repository', () => {
    render(
      <ExportManifestButton appId="123" syncEnabled={false} hasRepository={true} />,
    )
    expect(screen.getByText(/export to repository/i)).toBeInTheDocument()
  })
})
