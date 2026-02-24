import { NextRequest, NextResponse } from 'next/server'

const SETUP_PATHS = ['/setup', '/api/setup']
const INTERNAL_PATHS = ['/api/setup/check', '/api/auth']

function isSetupAllowlisted(pathname: string): boolean {
  return SETUP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function isInternalPath(pathname: string): boolean {
  return INTERNAL_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

async function checkSetupComplete(request: NextRequest): Promise<boolean> {
  try {
    const checkUrl = new URL('/api/setup/check', request.url)
    const response = await fetch(checkUrl, { method: 'GET' })
    const data = await response.json()
    return data.setupComplete === true
  } catch {
    // If the check fails, assume setup is complete to avoid redirect loops
    return true
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow internal paths through without checking
  if (isInternalPath(pathname)) {
    return NextResponse.next()
  }

  const setupComplete = await checkSetupComplete(request)

  if (!setupComplete) {
    // Setup not done: allow /setup through, redirect everything else
    if (isSetupAllowlisted(pathname)) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  // Setup done: redirect /setup to /login
  if (pathname === '/setup') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
