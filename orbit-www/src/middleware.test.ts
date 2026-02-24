/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockHasUsers = vi.fn()

vi.mock('@/lib/setup', () => ({
  hasUsers: () => mockHasUsers(),
}))

const { middleware, config } = await import('./middleware')

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/setup')
  })

  it('does not redirect /setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not redirect /api/setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/api/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('passes through when users exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects /setup to /login when users already exist', async () => {
    mockHasUsers.mockResolvedValue(true)
    const response = await middleware(createRequest('/setup'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('does not redirect /api/auth when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/api/auth/signin'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects /api/setup-other to /setup when no users exist', async () => {
    mockHasUsers.mockResolvedValue(false)
    const response = await middleware(createRequest('/api/setup-other'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/setup')
  })

  it('has correct matcher config excluding static assets', () => {
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
    ])
  })
})
