import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrbitSkeletonPicker } from './OrbitSkeletonPicker'
import type { FieldComponentProps } from '../field-registry'

afterEach(() => {
  cleanup()
})

function baseProps(overrides: Partial<FieldComponentProps> = {}): FieldComponentProps {
  return {
    id: 'field-1',
    schema: { type: 'string' },
    value: undefined,
    onChange: vi.fn(),
    ...overrides,
  }
}

describe('OrbitSkeletonPicker', () => {
  it('fetches skeleton options for the configured workspace via the stubbed fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { id: 'sk-1', name: 'Go service', slug: 'go-service', totalSize: 2048, fileCount: 4 },
    ])
    render(
      <OrbitSkeletonPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('ws-1'))
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
  })

  it('shows a loading state before the fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    render(
      <OrbitSkeletonPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    resolveFetch([])
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())
  })

  it('shows an empty state with a link to create a skeleton when none exist', async () => {
    const fetcher = vi.fn().mockResolvedValue([])
    render(
      <OrbitSkeletonPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    const link = await screen.findByRole('link', { name: /create a skeleton/i })
    expect(link).toHaveAttribute('href', '/self-service/templates/skeletons/new')
  })

  it('selecting a skeleton calls onChange with its id and shows file count/size', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const fetcher = vi.fn().mockResolvedValue([
      { id: 'sk-1', name: 'Go service', slug: 'go-service', totalSize: 2048, fileCount: 4 },
    ])
    render(
      <OrbitSkeletonPicker
        {...baseProps({
          onChange,
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    const option = await screen.findByText(/Go service/)
    expect(option.textContent).toMatch(/4 files/i)
    expect(option.textContent).toMatch(/2 KB|2048/i)
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('sk-1')
  })

  it('shows the option matching a controlled `value` as selected once options load', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { id: 'sk-1', name: 'Go service', slug: 'go-service', totalSize: 2048, fileCount: 4 },
      { id: 'sk-2', name: 'Node service', slug: 'node-service', totalSize: 512, fileCount: 2 },
    ])
    render(
      <OrbitSkeletonPicker
        {...baseProps({
          value: 'sk-1',
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(await screen.findByText(/Go service/)).toBeInTheDocument()
  })
})
