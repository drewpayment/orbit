import { NextRequest, NextResponse } from 'next/server'
import { validatePullToken, generateDockerToken } from '@/lib/registry-auth'

export async function GET(request: NextRequest) {
  try {
    // Parse Basic auth header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Basic ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="orbit-registry"',
          },
        }
      )
    }

    const base64Credentials = authHeader.slice(6)
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
    const [username, password] = credentials.split(':')

    if (username !== 'orbit-pull' || !password) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Validate the JWT from password field
    let claims
    try {
      claims = await validatePullToken(password)
    } catch (error) {
      console.error('[Registry Token] JWT validation failed:', error)
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      )
    }

    // Get requested scope from query params
    const url = new URL(request.url)
    const requestedScope = url.searchParams.get('scope')

    if (!requestedScope) {
      return NextResponse.json(
        { error: 'Scope parameter required' },
        { status: 400 }
      )
    }

    // Verify requested scope matches token scope
    if (claims.scope !== requestedScope) {
      console.error(
        `[Registry Token] Scope mismatch: token=${claims.scope}, requested=${requestedScope}`
      )
      return NextResponse.json(
        { error: 'Scope not authorized' },
        { status: 403 }
      )
    }

    // Generate Docker registry token
    const dockerToken = await generateDockerToken({
      scope: requestedScope,
    })

    return NextResponse.json(dockerToken)
  } catch (error) {
    console.error('[Registry Token] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
