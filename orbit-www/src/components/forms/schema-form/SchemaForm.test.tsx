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

describe('SchemaForm nested object fields', () => {
  it('recurses into a nested SchemaForm and does not render a dangling htmlFor on the group label', () => {
    const { container } = render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: {
              address: {
                type: 'object',
                title: 'Address',
                properties: { city: { type: 'string', title: 'City' } },
              },
            },
          },
        })}
      />,
    )

    expect(screen.getByText('Address')).toBeInTheDocument()
    expect(screen.getByText('City')).toBeInTheDocument()
    // The group label must not be a <FormLabel> pointing at a
    // FormField/FormItem context it isn't inside — no id should ever
    // resolve to the literal "undefined-form-item".
    const labels = Array.from(container.querySelectorAll('label'))
    for (const label of labels) {
      expect(label.getAttribute('for')).not.toBe('undefined-form-item')
    }
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

describe('SchemaForm number/integer enum', () => {
  it('coerces a number-enum Select value back to a number on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <SchemaForm
        pages={onePage({
          schema: {
            type: 'object',
            properties: { count: { type: 'number', title: 'Count', enum: [1, 2, 3] } },
          },
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: '2' }))
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].count).toBe(2)
    expect(typeof onSubmit.mock.calls[0][0].count).toBe('number')
  })
})

describe('SchemaForm wizard mode multi-page validation', () => {
  function wizardPages(): SchemaFormPage[] {
    return [
      {
        title: 'Page 1',
        schema: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Name' } },
          required: ['name'],
        },
      },
      {
        title: 'Page 2',
        schema: { type: 'object', properties: { nickname: { type: 'string', title: 'Nickname' } } },
      },
    ]
  }

  it('blocks Next when the active page has a validation error', async () => {
    const user = userEvent.setup()
    render(<SchemaForm pages={wizardPages()} />)

    await user.click(screen.getByRole('button', { name: /next/i }))

    // Still on page 1 — Next was blocked by the required-field error.
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.queryByText('Nickname')).not.toBeInTheDocument()
  })

  it('allows Next once the active page is valid', async () => {
    const user = userEvent.setup()
    render(<SchemaForm pages={wizardPages()} />)

    // Name is required, so its accessible name includes the "*" marker —
    // match by prefix rather than an exact string.
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Ada')
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByText('Nickname')).toBeInTheDocument()
    expect(screen.queryByText('Name')).not.toBeInTheDocument()
  })

  it('final submit validates every page and jumps back to the page owning the error', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SchemaForm pages={wizardPages()} onSubmit={onSubmit} />)

    // Jump directly to page 2 via the page tab (bypasses Next's per-page gate).
    await user.click(screen.getByRole('button', { name: 'Page 2' }))
    expect(screen.getByText('Nickname')).toBeInTheDocument()

    // Submit from page 2 while page 1's required field is still empty.
    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    // Jumped back to page 1 so the error is visible.
    await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument())
    expect(screen.getByText(/required|invalid|expected/i)).toBeInTheDocument()
  })
})

describe('SchemaForm FormControl wiring', () => {
  it('is queryable by label text (FormControl supplies the id, not a manually-set id={field.name})', () => {
    render(
      <SchemaForm
        pages={onePage({
          schema: { type: 'object', properties: { email: { type: 'string', title: 'Email' } } },
        })}
      />,
    )
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('does not emit duplicate element ids when two SchemaForm instances share a field name', () => {
    const page = onePage({
      schema: { type: 'object', properties: { email: { type: 'string', title: 'Email' } } },
    })
    const { container } = render(
      <div>
        <SchemaForm pages={page} />
        <SchemaForm pages={page} />
      </div>,
    )
    const inputs = container.querySelectorAll('input')
    const ids = Array.from(inputs).map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

describe('SchemaForm hidden-field payload stripping', () => {
  it('strips a field\'s value from the submitted payload once visibleIf hides it, matching validation exemption', async () => {
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
          },
          uiSchema: {
            extra: { 'ui:visibleIf': '${{ parameters.enableExtra }}' },
          },
        })}
        values={{ enableExtra: true, extra: 'leftover-value' }}
        onSubmit={onSubmit}
      />,
    )

    // extra is visible and filled initially.
    expect(screen.getByText('Extra field')).toBeInTheDocument()

    // Hide it again.
    await user.click(screen.getByRole('switch'))
    expect(screen.queryByText('Extra field')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0]
    expect(submitted).not.toHaveProperty('extra')
    expect(submitted.enableExtra).toBe(false)
  })
})
