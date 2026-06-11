/**
 * Service-to-service auth token minting.
 *
 * orbit-www is the only trusted caller of the Go gRPC/Connect services. For
 * every outbound call we mint a short-TTL HS256 JWT that the services verify
 * with the shared ORBIT_SVC_AUTH_SECRET (see proto/pkg/svcauth and
 * docs/plans/2026-06-10-grpc-auth-interceptor-design.md).
 *
 * The claims mirror the Go-side svcauth.Claims:
 *   iss=orbit-www, aud=orbit-services, sub=<betterAuthId>, wid=<workspace>,
 *   iat/exp (120s), jti=<random>.
 *
 * This module is server-only. The secret is read from a non-NEXT_PUBLIC env var
 * and never reaches the browser.
 */
import 'server-only'
import * as jose from 'jose'
import { randomUUID } from 'node:crypto'

const ISSUER = 'orbit-www'
const AUDIENCE = 'orbit-services'
const TTL_SECONDS = 120
const MIN_SECRET_BYTES = 32

/**
 * Read and validate the shared secret. Throws on a missing or too-short secret
 * so a misconfigured deploy fails the call loudly rather than silently sending
 * unauthenticated traffic — this mirrors the Go side's fail-fast LoadSecret.
 */
function loadSecret(): Uint8Array {
  const raw = process.env.ORBIT_SVC_AUTH_SECRET
  if (!raw) {
    throw new Error('ORBIT_SVC_AUTH_SECRET is not set')
  }
  const bytes = new TextEncoder().encode(raw)
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new Error(
      `ORBIT_SVC_AUTH_SECRET must be at least ${MIN_SECRET_BYTES} bytes (got ${bytes.length})`,
    )
  }
  return bytes
}

/**
 * Mint a service-auth JWT for a single outbound call.
 *
 * @param subject     betterAuthId of the acting user (session.user.id).
 * @param workspaceId the workspace the user is authorized to act in for this
 *                    request; signed into `wid` and enforced by the services
 *                    against the request body's workspace_id. May be empty for
 *                    RPCs that carry no workspace scope.
 */
export async function mintServiceToken(subject: string, workspaceId: string): Promise<string> {
  if (!subject) {
    throw new Error('mintServiceToken: subject (betterAuthId) is required')
  }

  const secret = loadSecret()
  const now = Math.floor(Date.now() / 1000)

  return new jose.SignJWT({ wid: workspaceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .setJti(randomUUID())
    .sign(secret)
}
