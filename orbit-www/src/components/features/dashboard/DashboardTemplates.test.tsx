import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardTemplates } from './DashboardTemplates'
import type { TemplateRow } from './DashboardTemplates'

const fixtures: TemplateRow[] = [
  { id: 'static-site', name: 'Static site', description: 'Vite / Astro / Next.js export · Render', icon: 'box' },
  { id: 'go-service', name: 'Go HTTP service', description: 'Chi router · Postgres · Vault secrets', icon: 'git' },
]

describe('DashboardTemplates', () => {
  afterEach(() => { cleanup() })

  it('should render nothing when templates is empty', () => {
    const { container } = render(<DashboardTemplates templates={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render template names and descriptions', () => {
    render(<DashboardTemplates templates={fixtures} />)
    expect(screen.getByText('Static site')).toBeInTheDocument()
    expect(screen.getByText('Go HTTP service')).toBeInTheDocument()
    expect(screen.getByText(/Vite \/ Astro/)).toBeInTheDocument()
  })

  it('should render Browse link to the templates index', () => {
    render(<DashboardTemplates templates={fixtures} browseHref="/templates" />)
    const browseLink = screen.getByRole('link', { name: /Browse/i })
    expect(browseLink).toHaveAttribute('href', '/templates')
  })
})
