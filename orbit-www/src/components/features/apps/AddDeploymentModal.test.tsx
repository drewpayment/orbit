import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddDeploymentModal } from './AddDeploymentModal'

// Mock server actions
vi.mock('@/app/actions/deployments', () => ({
  createDeployment: vi.fn().mockResolvedValue({ success: true, deploymentId: 'dep-123' }),
  getDeploymentGenerators: vi.fn().mockResolvedValue({ success: false, generators: [] }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  appId: 'app-123',
  appName: 'My Test App',
}

describe('AddDeploymentModal', () => {
  afterEach(cleanup)

  describe('Docker Compose generator', () => {
    it('shows docker-compose fields when generator is docker-compose', async () => {
      render(<AddDeploymentModal {...defaultProps} />)

      // The default generator is docker-compose
      // serviceName and port fields should be visible
      expect(screen.getByLabelText(/service name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/port/i)).toBeInTheDocument()
    })

    it('does not show helm fields when generator is docker-compose', async () => {
      render(<AddDeploymentModal {...defaultProps} />)

      // Helm-specific fields should not be visible in docker-compose mode
      expect(screen.queryByLabelText(/release name/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/namespace/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/replicas/i)).not.toBeInTheDocument()
    })

    it('shows docker-compose description when generator is docker-compose', async () => {
      render(<AddDeploymentModal {...defaultProps} />)

      expect(screen.getByText(/docker-compose\.yml/i)).toBeInTheDocument()
    })
  })

  describe('Helm generator', () => {
    it('shows helm fields when generator is helm', async () => {
      const user = userEvent.setup()
      render(<AddDeploymentModal {...defaultProps} />)

      // Change generator to helm
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      const helmOption = screen.getByRole('option', { name: /helm/i })
      await user.click(helmOption)

      // Helm-specific fields should be visible
      expect(screen.getByLabelText(/release name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/namespace/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/replicas/i)).toBeInTheDocument()
    })

    it('does not show docker-compose service name when generator is helm', async () => {
      const user = userEvent.setup()
      render(<AddDeploymentModal {...defaultProps} />)

      // Change generator to helm
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      const helmOption = screen.getByRole('option', { name: /helm/i })
      await user.click(helmOption)

      // Docker-compose serviceName should not be visible
      expect(screen.queryByLabelText(/service name/i)).not.toBeInTheDocument()
    })

    it('shows helm description when generator is helm', async () => {
      const user = userEvent.setup()
      render(<AddDeploymentModal {...defaultProps} />)

      // Change generator to helm
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      const helmOption = screen.getByRole('option', { name: /helm/i })
      await user.click(helmOption)

      expect(screen.getByText(/Chart\.yaml/i)).toBeInTheDocument()
    })
  })

  describe('Form submission', () => {
    let mockCreateDeployment: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const { createDeployment } = await import('@/app/actions/deployments')
      mockCreateDeployment = vi.mocked(createDeployment)
      mockCreateDeployment.mockClear()
      mockCreateDeployment.mockResolvedValue({ success: true, deploymentId: 'dep-123' })
    })

    it('submits docker-compose config with serviceName and port', async () => {
      const user = userEvent.setup()
      render(<AddDeploymentModal {...defaultProps} />)

      // Submit the form (docker-compose is default)
      const submitButton = screen.getByRole('button', { name: /create deployment/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(mockCreateDeployment).toHaveBeenCalledWith(
          expect.objectContaining({
            generator: 'docker-compose',
            config: expect.objectContaining({
              serviceName: expect.any(String),
              port: expect.any(Number),
            }),
          })
        )
      })

      // Ensure helm fields are NOT in the config
      const callArgs = mockCreateDeployment.mock.calls[0][0]
      expect(callArgs.config).not.toHaveProperty('releaseName')
      expect(callArgs.config).not.toHaveProperty('namespace')
      expect(callArgs.config).not.toHaveProperty('replicas')
    })

    it('submits helm config with releaseName, namespace, replicas, and port', async () => {
      const user = userEvent.setup()
      render(<AddDeploymentModal {...defaultProps} />)

      // Change generator to helm
      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      const helmOption = screen.getByRole('option', { name: /helm/i })
      await user.click(helmOption)

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /create deployment/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(mockCreateDeployment).toHaveBeenCalledWith(
          expect.objectContaining({
            generator: 'helm',
            config: expect.objectContaining({
              releaseName: expect.any(String),
              namespace: expect.any(String),
              replicas: expect.any(Number),
              port: expect.any(Number),
            }),
          })
        )
      })

      // Ensure docker-compose serviceName is NOT in the helm config
      const callArgs = mockCreateDeployment.mock.calls[0][0]
      expect(callArgs.config).not.toHaveProperty('serviceName')
    })
  })
})
