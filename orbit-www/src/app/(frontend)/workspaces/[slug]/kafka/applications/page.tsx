import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { ApplicationsClient } from './applications-client'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function KafkaApplicationsPage({ params }: PageProps) {
  const { slug } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  return (
    <ApplicationsClient workspaceId={workspace.id} workspaceSlug={slug} />
  )
}
