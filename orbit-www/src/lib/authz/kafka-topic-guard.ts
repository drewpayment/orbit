import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, authorize, authzErrorResponse, type Verb } from '@/lib/authz'

/**
 * Route Handler guard for endpoints keyed by a Kafka `topicId`: resolve the
 * topic's owning workspace and require the caller to hold `verb` there
 * (platform admins pass). Returns a 401/403/404 response to return as-is, or
 * null when the caller may proceed.
 *
 * The schema server actions do not check workspace membership themselves, so
 * the HTTP routes gate here. Authentication is checked before the topic lookup
 * so anonymous callers cannot probe topic ids.
 */
export async function guardTopicWorkspace(topicId: string, verb: Verb): Promise<NextResponse | null> {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const payload = await getPayload({ config })
    let workspaceId: string | null = null
    try {
      const topic = await payload.findByID({
        collection: 'kafka-topics',
        id: topicId,
        depth: 0,
        overrideAccess: true,
      })
      const ws = topic?.workspace as unknown
      workspaceId = ws && typeof ws === 'object' ? String((ws as { id: unknown }).id) : ws ? String(ws) : null
    } catch {
      workspaceId = null
    }
    if (!workspaceId) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

    await authorize(verb, { kind: 'workspace', id: workspaceId }, actor)
    return null
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
