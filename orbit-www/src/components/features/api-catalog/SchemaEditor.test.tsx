import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SchemaEditor } from './SchemaEditor';

// Mock the API catalog client
vi.mock('@/lib/grpc/api-catalog-client', () => ({
  apiCatalogClient: {
    saveSchema: vi.fn().mockResolvedValue({
      schemaId: 'schema-123',
      version: '1.0.0'
    })
  }
}));

// Mock Monaco editor
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, testId }: any) => (
    <textarea
      data-testid={testId || 'monaco-editor'}
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
    />
  )
}));

describe('SchemaEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders monaco editor', () => {
    render(<SchemaEditor workspaceId="ws-123" />);
    expect(screen.getByTestId('schema-editor')).toBeTruthy();
  });

  it('allows selecting schema type', () => {
    render(<SchemaEditor workspaceId="ws-123" />);

    expect(screen.getByRole('combobox', { name: /schema type/i })).toBeTruthy();
  });

  it('validates protobuf syntax and shows errors', async () => {
    render(<SchemaEditor workspaceId="ws-123" schemaType="protobuf" />);

    const editor = screen.getByTestId('monaco-editor');

    // Invalid proto syntax - missing semicolon
    fireEvent.change(editor, {
      target: { value: 'syntax = "invalid"' }
    });

    await waitFor(() => {
      expect(screen.getByText(/validation error/i)).toBeTruthy();
    });
  });

  it('allows saving valid schema', async () => {
    const mockOnSave = vi.fn();
    render(<SchemaEditor workspaceId="ws-123" schemaType="protobuf" onSave={mockOnSave} />);

    const validProto = 'syntax = "proto3";\n\nservice TestService {\n  rpc Test(Request) returns (Response);\n}';
    const editor = screen.getByTestId('monaco-editor');

    fireEvent.change(editor, { target: { value: validProto } });

    const saveButton = screen.getByRole('button', { name: /save schema/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        schemaContent: validProto,
        schemaType: 'protobuf'
      }));
    });
  });

  it('shows loading state while saving', async () => {
    render(<SchemaEditor workspaceId="ws-123" />);

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, {
      target: { value: 'syntax = "proto3";' }
    });

    const saveButton = screen.getByRole('button', { name: /save schema/i });
    fireEvent.click(saveButton);

    // Should show loading state
    expect(screen.getByRole('button', { name: /saving/i })).toBeTruthy();
  });

  it('disables save button for invalid schema', async () => {
    render(<SchemaEditor workspaceId="ws-123" schemaType="protobuf" />);

    const editor = screen.getByTestId('monaco-editor');

    // Invalid syntax
    fireEvent.change(editor, {
      target: { value: 'invalid syntax' }
    });

    await waitFor(() => {
      const saveButton = screen.getByRole('button', { name: /save schema/i });
      expect(saveButton).toHaveProperty('disabled', true);
    });
  });
});
