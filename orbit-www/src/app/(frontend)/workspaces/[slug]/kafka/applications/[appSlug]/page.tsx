import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{
    slug: string
    appSlug: string
  }>
}

/**
 * Redirect from old /kafka/applications/[appSlug] route to new /kafka Virtual Clusters route.
 * Note: We cannot map the old appSlug to a specific virtual cluster ID, so we redirect to the
 * main Virtual Clusters list. This maintains backward compatibility for existing bookmarks.
 */
export default async function ApplicationDetailRedirect({ params }: PageProps) {
  const { slug } = await params
  redirect(`/workspaces/${slug}/kafka`)
}
