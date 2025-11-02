import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RepositoryWizard } from './RepositoryWizard';

// Mock the repository client to avoid proto import issues
vi.mock('@/lib/grpc/repository-client', () => ({
  repositoryClient: {
    createRepository: vi.fn().mockResolvedValue({
      repository: { id: 'repo-123', name: 'my-service' }
    })
  }
}));

describe('RepositoryWizard', () => {
  const mockOnComplete = vi.fn();
  const mockWorkspaceId = 'ws-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders template selection step initially', () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    expect(screen.getByText('Select Template')).toBeTruthy();
    expect(screen.getByText(/choose a repository template/i)).toBeTruthy();
  });

  it('shows configuration step after template selection', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Select service template
    const serviceTemplate = screen.getByTestId('template-service');
    fireEvent.click(serviceTemplate);

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Configure Repository')).toBeTruthy();
      expect(screen.getByLabelText(/repository name/i)).toBeTruthy();
    });
  });

  it('validates required fields', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Go to config step
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Try to proceed without filling required fields
    await waitFor(() => screen.getByText('Configure Repository'));

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText(/repository name is required/i)).toBeTruthy();
    });
  });

  it('shows review step with summary', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Complete first two steps
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByLabelText(/repository name/i));

    fireEvent.change(screen.getByLabelText(/repository name/i), {
      target: { value: 'my-service' }
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Test service' }
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeTruthy();
      expect(screen.getAllByText('my-service').length).toBeGreaterThan(0);
      expect(screen.getByText('Test service')).toBeTruthy();
    });
  });

  it('calls onComplete when creation succeeds', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Complete all steps
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByLabelText(/repository name/i));
    fireEvent.change(screen.getByLabelText(/repository name/i), {
      target: { value: 'my-service' }
    });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByText('Review & Create'));
    fireEvent.click(screen.getByRole('button', { name: /create repository/i }));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith('repo-123');
    });
  });
});
