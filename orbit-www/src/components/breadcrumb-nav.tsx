'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

interface BreadcrumbItem {
  label: string
  href: string
}

interface BreadcrumbNavProps {
  items?: BreadcrumbItem[]
  workspaceName?: string
}

export function BreadcrumbNav({ items, workspaceName }: BreadcrumbNavProps) {
  const pathname = usePathname()

  // Generate breadcrumbs from pathname if no items provided
  const breadcrumbs = items || generateBreadcrumbs(pathname, workspaceName)

  return (
    <nav className="flex items-center space-x-1 text-sm text-muted-foreground">
      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1

        return (
          <Fragment key={item.href}>
            {index > 0 && (
              <ChevronRight className="h-4 w-4 flex-shrink-0" />
            )}
            {isLast ? (
              <span className="font-medium text-foreground">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

function generateBreadcrumbs(pathname: string, workspaceName?: string): BreadcrumbItem[] {
  const paths = pathname.split('/').filter(Boolean)
  const breadcrumbs: BreadcrumbItem[] = []

  // Skip if we're at the root
  if (paths.length === 0) {
    return breadcrumbs
  }

  let currentPath = ''
  paths.forEach((path, index) => {
    currentPath += `/${path}`
    
    // Format the label
    let label = path
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    // Special cases for known routes
    if (path === 'dashboard') {
      label = 'Dashboard'
    } else if (path === 'workspaces') {
      label = 'Workspaces'
    } else if (index === 1 && paths[0] === 'workspaces' && workspaceName) {
      // This is a workspace slug, use the workspace name if provided
      label = workspaceName
    }

    breadcrumbs.push({
      label,
      href: currentPath,
    })
  })

  return breadcrumbs
}
