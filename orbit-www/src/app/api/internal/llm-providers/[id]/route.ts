export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * Internal endpoint used by the temporal-workflows agent worker to fetch a
 * decrypted LLM provider configuration. Auth is by the shared internal API
 * key (never exposed to end users).
 *
 * The response intentionally returns the apiKey in plaintext; only callers
 * holding ORBIT_INTERNAL_API_KEY can reach this route.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: 'id required', code: 'BAD_REQUEST' },
      { status: 400 },
    )
  }

  const workspaceFilter = request.nextUrl.searchParams.get('workspace_id')

  try {
    const payload = await getPayload({ config: configPromise })

    const doc = await payload.findByID({
      collection: 'llm-providers',
      id,
      overrideAccess: true,
    })

    if (workspaceFilter) {
      const workspaceId =
        typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
      if (workspaceId !== workspaceFilter) {
        return NextResponse.json(
          { error: 'workspace mismatch', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
    }

    let plainKey = ''
    if (doc.apiKey) {
      try {
        plainKey = decrypt(doc.apiKey)
      } catch {
        // The EncryptedField may store the value already-encrypted from the UI
        // pass; if decryption fails the value is treated as plaintext (e.g.
        // self-hosted backend with no key).
        plainKey = doc.apiKey
      }
    }

    return NextResponse.json({
      id: doc.id,
      workspaceId:
        typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id,
      provider: doc.provider,
      baseUrl: doc.baseUrl ?? '',
      model: doc.model,
      apiKey: plainKey,
      isDefault: Boolean(doc.isDefault),
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
