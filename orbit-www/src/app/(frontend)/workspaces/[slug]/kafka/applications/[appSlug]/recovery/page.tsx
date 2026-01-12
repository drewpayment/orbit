import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { OffsetRecoveryClient } from './recovery-client'

interface PageProps {
  params: Promise<{
    slug: string
    appSlug: string
  }>
}

export default async function OffsetRecoveryPage({ params }: PageProps) {
  const { slug: workspaceSlug, appSlug } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const payload = await getPayload({ config })

  // Get workspace
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: workspaceSlug } },
    limit: 1,
  })

  const workspace = workspaces.docs[0]
  if (!workspace) {
    notFound()
  }

  // Check membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    redirect(`/workspaces`)
  }

  // Get application
  const applications = await payload.find({
    collection: 'kafka-applications',
    where: {
      and: [{ workspace: { equals: workspace.id } }, { slug: { equals: appSlug } }],
    },
    limit: 1,
    overrideAccess: true,
  })

  const application = applications.docs[0]
  if (!application) {
    notFound()
  }

  return (
    <OffsetRecoveryClient
      workspaceSlug={workspaceSlug}
      application={{
        id: application.id,
        name: application.name,
        slug: application.slug,
      }}
    />
  )
}
