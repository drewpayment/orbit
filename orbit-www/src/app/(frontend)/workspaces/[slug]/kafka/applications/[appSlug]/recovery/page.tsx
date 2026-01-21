import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{
    slug: string
    appSlug: string
  }>
}

/**
 * Redirect from old /kafka/applications/[appSlug]/recovery route to new /kafka Virtual Clusters route.
 * This maintains backward compatibility for existing bookmarks and links.
 */
export default async function OffsetRecoveryRedirect({ params }: PageProps) {
  const { slug } = await params
  redirect(`/workspaces/${slug}/kafka`)
}
