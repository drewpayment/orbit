import { NextRequest, NextResponse } from 'next/server'
import { hasUsers } from '@/lib/setup'

export const runtime = 'nodejs'

const SETUP_PATHS = ['/setup', '/api/setup']

function isSetupAllowlisted(pathname: string): boolean {
  return SETUP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isSetupPath = isSetupAllowlisted(pathname)
  const isAuthApi = pathname.startsWith('/api/auth')

  const usersExist = await hasUsers()

  if (!usersExist) {
    if (isSetupPath || isAuthApi) {
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

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
