import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageFilterToolbar } from './MessageFilterToolbar'

describe('MessageFilterToolbar', () => {
  afterEach(() => cleanup())

  const defaultProps = {
    seekMode: 'NEWEST' as const,
    onSeekModeChange: vi.fn(),
    partition: null,
    onPartitionChange: vi.fn(),
    startOffset: 0,
    onStartOffsetChange: vi.fn(),
    partitionCount: 3,
    canProduce: true,
    onRefresh: vi.fn(),
    onProduce: vi.fn(),
    loading: false,
  }

  it('renders seek mode selector', () => {
    render(<MessageFilterToolbar {...defaultProps} />)
    expect(screen.getByText('Newest')).toBeInTheDocument()
  })

  it('renders partition selector', () => {
    render(<MessageFilterToolbar {...defaultProps} />)
    expect(screen.getByText('All Partitions')).toBeInTheDocument()
  })

  it('shows produce button when canProduce is true', () => {
    render(<MessageFilterToolbar {...defaultProps} canProduce={true} />)
    expect(screen.getByText('Produce Message')).toBeInTheDocument()
  })

  it('hides produce button when canProduce is false', () => {
    render(<MessageFilterToolbar {...defaultProps} canProduce={false} />)
    expect(screen.queryByText('Produce Message')).not.toBeInTheDocument()
  })

  it('calls onProduce when produce button is clicked', async () => {
    const user = userEvent.setup()
    const onProduce = vi.fn()

    render(
      <MessageFilterToolbar {...defaultProps} onProduce={onProduce} />,
    )

    await user.click(screen.getByText('Produce Message'))
    expect(onProduce).toHaveBeenCalledOnce()
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    render(
      <MessageFilterToolbar {...defaultProps} onRefresh={onRefresh} />,
    )

    // Refresh button is the icon button
    const buttons = screen.getAllByRole('button')
    const refreshBtn = buttons.find(
      (b) => !b.textContent?.includes('Produce'),
    )!
    await user.click(refreshBtn)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('does not show offset input when seek mode is NEWEST', () => {
    render(<MessageFilterToolbar {...defaultProps} seekMode="NEWEST" />)
    expect(screen.queryByPlaceholderText('Offset')).not.toBeInTheDocument()
  })

  it('shows offset input when seek mode is OFFSET', () => {
    render(<MessageFilterToolbar {...defaultProps} seekMode="OFFSET" />)
    expect(screen.getByPlaceholderText('Offset')).toBeInTheDocument()
  })
})
