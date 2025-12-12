import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { InstallationPicker } from './InstallationPicker'

describe('InstallationPicker', () => {
  afterEach(() => {
    cleanup()
  })

  const mockInstallations = [
    {
      id: 'install-1',
      installationId: 12345,
      accountLogin: 'acme-org',
      accountAvatarUrl: 'https://github.com/acme.png',
      accountType: 'Organization' as const,
    },
    {
      id: 'install-2',
      installationId: 67890,
      accountLogin: 'other-org',
      accountAvatarUrl: 'https://github.com/other.png',
      accountType: 'Organization' as const,
    },
  ]

  it('should render select with installations', async () => {
    const user = userEvent.setup()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    // Open the select
    await user.click(screen.getByRole('combobox'))

    expect(screen.getByText('acme-org')).toBeInTheDocument()
    expect(screen.getByText('other-org')).toBeInTheDocument()
  })

  it('should show selected installation', () => {
    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={mockInstallations[0]}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('acme-org')
  })

  it('should call onSelect when installation selected', async () => {
    const user = userEvent.setup()
    const mockOnSelect = vi.fn()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={mockOnSelect}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('other-org'))

    expect(mockOnSelect).toHaveBeenCalledWith(mockInstallations[1])
  })

  it('should show placeholder when nothing selected', () => {
    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent(/select.*github/i)
  })

  it('should display avatar for installations', async () => {
    const user = userEvent.setup()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    await user.click(screen.getByRole('combobox'))

    // Avatar components render with data-slot attribute
    const avatars = screen.getAllByRole('option')
    expect(avatars.length).toBe(2)
    // Check that each option contains an avatar (via fallback letters)
    expect(screen.getByText('A')).toBeInTheDocument() // acme-org fallback
    expect(screen.getByText('O')).toBeInTheDocument() // other-org fallback
  })
})
