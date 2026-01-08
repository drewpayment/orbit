'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface KafkaNavigationProps {
  slug: string
}

export function KafkaNavigation({ slug }: KafkaNavigationProps) {
  const pathname = usePathname()

  const navItems = [
    { href: `/workspaces/${slug}/kafka`, label: 'Topics', exact: true },
    { href: `/workspaces/${slug}/kafka/catalog`, label: 'Topic Catalog' },
    { href: `/workspaces/${slug}/kafka/shared/incoming`, label: 'Incoming Shares' },
    { href: `/workspaces/${slug}/kafka/shared/outgoing`, label: 'My Requests' },
  ]

  const isActive = (href: string, exact?: boolean) => {
    if (exact) {
      // For exact match, also check if we're on a topic detail page
      const topicDetailPattern = new RegExp(`^/workspaces/${slug}/kafka/[^/]+$`)
      if (topicDetailPattern.test(pathname) && !pathname.includes('/catalog') && !pathname.includes('/shared')) {
        return href === `/workspaces/${slug}/kafka`
      }
      return pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="border-b mb-6 -mx-8 px-8">
      <div className="flex gap-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'py-3 px-4 text-sm font-medium border-b-2 transition-colors',
              isActive(item.href, item.exact)
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
