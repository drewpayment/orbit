import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrbitEntityPicker } from './OrbitEntityPicker'
import { OrbitRepoPicker } from './OrbitRepoPicker'
import { OrbitTeamPicker } from './OrbitTeamPicker'
import { OrbitWorkspacePicker } from './OrbitWorkspacePicker'
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

describe('OrbitTeamPicker', () => {
  it('fetches team/member options for the configured workspace via the stubbed fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 'u1', label: 'u1', description: 'owner' }])
    render(
      <OrbitTeamPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('ws-1'))
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
  })
})

describe('OrbitEntityPicker', () => {
  it('fetches entities for the configured workspace + kind', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 'e1', label: 'svc-a' }])
    render(
      <OrbitEntityPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', kind: 'service', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('ws-1', 'service'))
  })
})

describe('OrbitRepoPicker', () => {
  it('fetches repos for the configured workspace + connection', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 'r1', label: 'repo-a' }])
    render(
      <OrbitRepoPicker
        {...baseProps({
          uiSchema: { 'ui:options': { workspaceId: 'ws-1', connection: 'conn-1', fetcher } },
        })}
      />,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('ws-1', 'conn-1'))
  })
})

describe('OrbitWorkspacePicker', () => {
  it('renders the caller-provided workspace list without any server fetch', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <OrbitWorkspacePicker
        {...baseProps({
          onChange,
          uiSchema: {
            'ui:options': {
              workspaces: [
                { id: 'ws-1', label: 'Workspace One' },
                { id: 'ws-2', label: 'Workspace Two' },
              ],
            },
          },
        })}
      />,
    )

    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    const option = await screen.findByText('Workspace One')
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('ws-1')
  })
})
