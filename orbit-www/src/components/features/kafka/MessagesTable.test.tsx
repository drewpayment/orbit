import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessagesTable } from './MessagesTable'
import type { MessageItem } from '@/app/actions/kafka-messages'

// Mock MessageDetail since it uses dynamic Monaco import
vi.mock('./MessageDetail', () => ({
  MessageDetail: ({ message }: { message: MessageItem }) => (
    <div data-testid="message-detail">Detail for offset {message.offset}</div>
  ),
}))

const mockMessages: MessageItem[] = [
  {
    partition: 0,
    offset: '42',
    timestamp: Date.now() - 60000,
    key: 'user-123',
    value: '{"action":"login"}',
    headers: {},
    keySize: 8,
    valueSize: 18,
    truncated: false,
  },
  {
    partition: 1,
    offset: '99',
    timestamp: Date.now() - 120000,
    key: null,
    value: '{"action":"logout"}',
    headers: { 'content-type': 'application/json' },
    keySize: 0,
    valueSize: 19,
    truncated: true,
  },
]

describe('MessagesTable', () => {
  afterEach(() => cleanup())

  it('renders column headers', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    expect(screen.getByText('Partition')).toBeInTheDocument()
    expect(screen.getByText('Offset')).toBeInTheDocument()
    expect(screen.getByText('Timestamp')).toBeInTheDocument()
    expect(screen.getByText('Key')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
  })

  it('renders message rows', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('99')).toBeInTheDocument()
    expect(screen.getByText('user-123')).toBeInTheDocument()
  })

  it('shows null key as italic text', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    const nullKeys = screen.getAllByText('null')
    expect(nullKeys.length).toBeGreaterThan(0)
  })

  it('expands row on click to show MessageDetail', async () => {
    const user = userEvent.setup()

    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('message-detail')).not.toBeInTheDocument()

    // Click the row containing offset 42
    const row = screen.getByText('42').closest('tr')!
    await user.click(row)

    expect(screen.getByTestId('message-detail')).toBeInTheDocument()
    expect(screen.getByText('Detail for offset 42')).toBeInTheDocument()
  })

  it('collapses row on second click', async () => {
    const user = userEvent.setup()

    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    const row = screen.getByText('42').closest('tr')!
    await user.click(row)
    expect(screen.getByTestId('message-detail')).toBeInTheDocument()

    await user.click(row)
    expect(screen.queryByTestId('message-detail')).not.toBeInTheDocument()
  })

  it('shows Load More button when hasMore is true', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={true}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    expect(screen.getByText('Load More')).toBeInTheDocument()
  })

  it('hides Load More button when hasMore is false', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />,
    )

    expect(screen.queryByText('Load More')).not.toBeInTheDocument()
  })

  it('calls onLoadMore when Load More is clicked', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()

    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={true}
        loadingMore={false}
        onLoadMore={onLoadMore}
      />,
    )

    await user.click(screen.getByText('Load More'))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('disables Load More when loadingMore is true', () => {
    render(
      <MessagesTable
        messages={mockMessages}
        hasMore={true}
        loadingMore={true}
        onLoadMore={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: /load more/i })
    expect(button).toBeDisabled()
  })
})
