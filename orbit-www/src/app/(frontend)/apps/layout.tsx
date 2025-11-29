import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Applications | Orbit',
  description: 'View and manage your applications',
}

export default function AppsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
