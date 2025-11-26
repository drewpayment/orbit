"use client"

import * as React from "react"
import {
  BookOpen,
  Building2,
  Command,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  MessageSquare,
  Settings2,
} from "lucide-react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { useSession } from "@/lib/auth-client"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navMainData = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: true,
      items: [],
    },
    {
      title: "Workspaces",
      url: "/workspaces",
      icon: Building2,
      items: [],
    },
    {
      title: "Templates",
      url: "/templates",
      icon: LayoutTemplate,
      items: [],
    },
    {
      title: "Documentation",
      url: "#", // Will be updated dynamically based on workspace
      icon: BookOpen,
      items: [], // No sub-items
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Team",
          url: "#",
        },
        {
          title: "Billing",
          url: "#",
        },
        {
          title: "Limits",
          url: "#",
        },
        {
          title: "GitHub",
          url: "/settings/github",
        },
        {
          title: "Templates",
          url: "/settings/templates",
        },
      ],
    },
]

const navSecondaryData = [
  {
    title: "Support",
    url: "/support",
    icon: LifeBuoy,
  },
  {
    title: "Feedback",
    url: "/feedback",
    icon: MessageSquare,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { data: session } = useSession()

  // Extract workspace slug from pathname if we're in a workspace route
  const workspaceSlug = React.useMemo(() => {
    const match = pathname?.match(/\/workspaces\/([^\/]+)/)
    return match ? match[1] : 'engineering' // Default to 'engineering'
  }, [pathname])

  // Update Documentation link based on current workspace
  const navMainWithWorkspace = React.useMemo(() => {
    return navMainData.map(item => {
      if (item.title === 'Documentation') {
        return {
          ...item,
          url: `/workspaces/${workspaceSlug}/knowledge`,
        }
      }
      return item
    })
  }, [workspaceSlug])

  // Prepare user data from session
  const user = React.useMemo(() => {
    if (!session?.user) {
      return {
        name: "Guest",
        email: "guest@orbit.dev",
        avatar: "/avatars/default.jpg",
      }
    }

    // Get initials from user name for avatar fallback
    const initials = session.user.name
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase() || session.user.email?.[0]?.toUpperCase() || 'U'

    return {
      name: session.user.name || session.user.email || "User",
      email: session.user.email || "",
      avatar: session.user.image || `/avatars/${initials}.jpg`,
      initials,
    }
  }, [session])

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Orbit IDP</span>
                  <span className="truncate text-xs">Developer Portal</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainWithWorkspace} />
        <NavProjects projects={[]} />
        <NavSecondary items={navSecondaryData} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}