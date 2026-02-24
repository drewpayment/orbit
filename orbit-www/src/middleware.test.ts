/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock global fetch — middleware calls /api/setup/check
const mockFetch = vi.fn()
global.fetch = mockFetch

const { middleware, config } = await import('./middleware')

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

function mockSetupComplete(complete: boolean) {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ setupComplete: complete }),
  })
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /setup when no users exist', async () => {
    mockSetupComplete(false)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/setup')
  })

  it('does not redirect /setup when no users exist', async () => {
    mockSetupComplete(false)
    const response = await middleware(createRequest('/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not redirect /api/setup when no users exist', async () => {
    mockSetupComplete(false)
    const response = await middleware(createRequest('/api/setup'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not call fetch for /api/setup/check (allowlisted)', async () => {
    const response = await middleware(createRequest('/api/setup/check'))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not call fetch for /api/auth paths (allowlisted)', async () => {
    const response = await middleware(createRequest('/api/auth/signin'))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBeNull()
  })

  it('passes through when users exist', async () => {
    mockSetupComplete(true)
    const response = await middleware(createRequest('/dashboard'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects /setup to /login when users already exist', async () => {
    mockSetupComplete(true)
    const response = await middleware(createRequest('/setup'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('redirects /api/setup-other to /setup when no users exist', async () => {
    mockSetupComplete(false)
    const response = await middleware(createRequest('/api/setup-other'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/setup')
  })

  it('passes through when fetch fails (safe default)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const response = await middleware(createRequest('/dashboard'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('has correct matcher config excluding static assets', () => {
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
    ])
  })
})
