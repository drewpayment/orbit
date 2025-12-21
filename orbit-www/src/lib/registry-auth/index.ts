import * as jose from 'jose'

const JWT_SECRET = process.env.ORBIT_REGISTRY_JWT_SECRET

if (!JWT_SECRET) {
  console.warn('ORBIT_REGISTRY_JWT_SECRET not set - registry auth will fail')
}

const DEFAULT_EXPIRY_SECONDS = 3600 // 1 hour

/**
 * Generate a pull token for an app
 */
export async function generatePullToken(options: {
  workspaceSlug: string
  appSlug: string
  expiresInSeconds?: number
}): Promise<string> {
  const { workspaceSlug, appSlug, expiresInSeconds = DEFAULT_EXPIRY_SECONDS } = options

  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new Uint8Array(Buffer.from(JWT_SECRET, 'utf-8'))
  const scope = `repository:${workspaceSlug}/${appSlug}:pull`

  const token = await new jose.SignJWT({
    scope,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('orbit')
    .setSubject('orbit-deployment')
    .setAudience('orbit-registry')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret)

  return token
}

export interface PullTokenClaims {
  iss: string
  sub: string
  aud: string
  exp: number
  iat: number
  scope: string
}

/**
 * Validate a pull token and return its claims
 */
export async function validatePullToken(token: string): Promise<PullTokenClaims> {
  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new Uint8Array(Buffer.from(JWT_SECRET, 'utf-8'))

  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: 'orbit',
    audience: 'orbit-registry',
  })

  return {
    iss: payload.iss as string,
    sub: payload.sub as string,
    aud: payload.aud as string,
    exp: payload.exp as number,
    iat: payload.iat as number,
    scope: payload.scope as string,
  }
}

/**
 * Generate a Docker registry token response
 * This is the format Docker clients expect from the token endpoint
 */
export async function generateDockerToken(options: {
  scope: string
}): Promise<{
  token: string
  expires_in: number
  issued_at: string
}> {
  if (!JWT_SECRET) {
    throw new Error('ORBIT_REGISTRY_JWT_SECRET not configured')
  }

  const secret = new Uint8Array(Buffer.from(JWT_SECRET, 'utf-8'))
  const now = new Date()

  // Docker registry token format
  const token = await new jose.SignJWT({
    access: [
      {
        type: 'repository',
        name: options.scope.replace('repository:', '').replace(':pull', ''),
        actions: ['pull'],
      },
    ],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('orbit')
    .setSubject('orbit-deployment')
    .setAudience('orbit-registry')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS)
    .sign(secret)

  return {
    token,
    expires_in: DEFAULT_EXPIRY_SECONDS,
    issued_at: now.toISOString(),
  }
}
