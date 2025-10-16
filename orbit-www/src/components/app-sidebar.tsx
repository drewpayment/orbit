"use client"

import * as React from "react"
import {
  BookOpen,
  Building2,
  Command,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Settings2,
} from "lucide-react"
import { usePathname } from "next/navigation"
import Link from "next/link"

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

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
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
      ],
    },
  ],
  navSecondary: [
    {
      title: "Support",
      url: "#",
      icon: LifeBuoy,
    },
    {
      title: "Feedback",
      url: "#",
      icon: MessageSquare,
    },
  ],
  projects: [],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  
  // Extract workspace slug from pathname if we're in a workspace route
  const workspaceSlug = React.useMemo(() => {
    const match = pathname?.match(/\/workspaces\/([^\/]+)/)
    return match ? match[1] : 'engineering' // Default to 'engineering'
  }, [pathname])

  // Update Documentation link based on current workspace
  const navMainWithWorkspace = React.useMemo(() => {
    return data.navMain.map(item => {
      if (item.title === 'Documentation') {
        return {
          ...item,
          url: `/workspaces/${workspaceSlug}/knowledge`,
        }
      }
      return item
    })
  }, [workspaceSlug])

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
                  <span className="truncate font-semibold">Orbit Inc</span>
                  <span className="truncate text-xs">Enterprise</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainWithWorkspace} />
        <NavProjects projects={data.projects} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}