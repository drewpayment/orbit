import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

/**
 * Redirect from old /kafka/applications route to new /kafka Virtual Clusters route.
 * This maintains backward compatibility for existing bookmarks and links.
 */
export default async function ApplicationsRedirect({ params }: PageProps) {
  const { slug } = await params
  redirect(`/workspaces/${slug}/kafka`)
}
