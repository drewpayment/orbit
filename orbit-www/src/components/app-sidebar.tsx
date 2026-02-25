"use client"

import * as React from "react"
import {
  BookOpen,
  Building2,
  Command,
  FileCode,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  LifeBuoy,
  MessageSquare,
  RadioTower,
  Settings2,
} from "lucide-react"
import Link from "next/link"
import { useSession } from "@/lib/auth-client"
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin"

import { NavMain } from "@/components/nav-main"
import { NavPlatform, type NavPlatformItem } from "@/components/nav-platform"
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
      title: "Applications",
      url: "/apps",
      icon: Layers,
      items: [],
    },
    {
      title: "API Catalog",
      url: "/catalog/apis",
      icon: FileCode,
      items: [],
    },
    {
      title: "Documentation",
      url: "/knowledge",
      icon: BookOpen,
      items: [],
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

// Platform admin navigation - only visible to platform admins
const navPlatformData: NavPlatformItem[] = [
  {
    title: "Kafka",
    url: "/platform/kafka",
    icon: RadioTower,
    items: [
      {
        title: "Pending Approvals",
        url: "/platform/kafka/pending-approvals",
      },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession()
  const { isPlatformAdmin } = usePlatformAdmin()

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
                <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
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
        <NavMain items={navMainData} />
        <NavPlatform items={navPlatformData} isVisible={isPlatformAdmin} />
        <NavSecondary items={navSecondaryData} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}