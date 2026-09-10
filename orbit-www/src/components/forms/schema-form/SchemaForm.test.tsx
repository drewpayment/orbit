import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaForm } from './SchemaForm'
import { createFieldRegistry, type FieldComponentProps } from './field-registry'
import type { SchemaFormPage } from './types'

afterEach(() => {
  cleanup()
})

function onePage(page: Partial<SchemaFormPage>): SchemaFormPage[] {
  return [{ title: 'Page 1', schema: { type: 'object', properties: {} }, ...page } as SchemaFormPage]
}

describe('SchemaForm', () => {
  it('renders required and optional fields with labels', () => {
    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Name' },
              nickname: { type: 'string', title: 'Nickname' },
            },
            required: ['name'],
          },
        })}
      />,
    )

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Nickname')).toBeInTheDocument()
  })

  it('renders a string enum as a select field', () => {
    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              color: { type: 'string', title: 'Color', enum: ['red', 'blue'] },
            },
          },
        })}
      />,
    )

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('hides a field when visibleIf evaluates false and shows it when true, exempting it from validation while hidden', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              enableExtra: { type: 'boolean', title: 'Enable extra' },
              extra: { type: 'string', title: 'Extra field' },
            },
            required: ['extra'],
          },
          uiSchema: {
            extra: { 'ui:visibleIf': '${{ parameters.enableExtra }}' },
          },
        })}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.queryByText('Extra field')).not.toBeInTheDocument()

    // Submitting while `extra` is hidden must succeed — hidden required fields
    // are unregistered from validation, not just visually hidden.
    const submitButton = screen.getByRole('button', { name: /submit/i })
    await user.click(submitButton)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    // Toggling the switch reveals the field.
    const toggle = screen.getByRole('switch')
    await user.click(toggle)
    expect(screen.getByText('Extra field')).toBeInTheDocument()
  })

  it('surfaces per-field validation errors on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Name', minLength: 2 },
            },
            required: ['name'],
          },
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/required|invalid|expected/i)).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders a custom field via a fieldRegistry override', () => {
    function CustomField({ id }: FieldComponentProps) {
      return <div data-testid="custom-field">{id}</div>
    }
    const registry = createFieldRegistry()
    registry.register('CustomField', CustomField)

    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              special: { type: 'string', title: 'Special' },
            },
          },
          uiSchema: {
            special: { 'ui:field': 'CustomField' },
          },
        })}
        fieldRegistry={registry}
      />,
    )

    expect(screen.getByTestId('custom-field')).toBeInTheDocument()
  })

  it('flags ui:secret fields in the emitted submit value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              token: { type: 'string', title: 'Token' },
            },
          },
          uiSchema: {
            token: { 'ui:secret': true },
          },
        })}
        onSubmit={onSubmit}
        values={{ token: 'shh' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      token: { value: 'shh', secret: true },
    })
  })
})

describe('SchemaForm as="div"', () => {
  it('renders no <form> and no submit button, for embedding inside a caller-owned form', () => {
    const { container } = render(
      <SchemaForm
        pages={onePage({
          schema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } },
        })}
        as="div"
      />,
    )
    expect(container.querySelector('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
  })
})

describe('SchemaForm within', () => {
  it('renders a submit button inside a <form>', () => {
    const { container } = render(<SchemaForm pages={onePage({ schema: { type: 'object', properties: {} } })} />)
    expect(container.querySelector('form')).toBeInTheDocument()
    // sanity re-export check that within/screen combo is usable
    expect(within(container).getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })
})
