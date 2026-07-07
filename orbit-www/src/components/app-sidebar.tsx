"use client"

import * as React from "react"
import {
  BookOpen,
  Bot,
  Building2,
  Cloud,
  Command,
  Container,
  GitBranch,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  MessageSquare,
  RadioTower,
  Settings,
  Sparkles,
  Shield,
  ShieldCheck,
  Telescope,
  TrendingUp,
  Workflow,
  Zap,
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

// Primary IDP surfaces (IDP refocus P0 — see docs/plans/2026-06-27-idp-refocus-*).
// The old per-feature rows (Applications, API Catalog, Templates, Launches,
// Infra Agent, Knowledge) now live as entry points *under* these surfaces:
// Catalog unifies Apps/APIs/Topics/Docs; Self-Service unifies Templates/
// Launches/Agent. Deep links to the old routes still resolve.
const navMainData = [
    {
      title: "Home",
      url: "/dashboard",
      icon: LayoutDashboard,
      items: [],
    },
    {
      title: "Catalog",
      url: "/catalog",
      icon: Layers,
      // Highlight on the unified catalog and the folded-in catalog surfaces.
      activeMatch: ["/catalog", "/apps", "/knowledge"],
      items: [],
    },
    {
      title: "Scorecards",
      url: "/scorecards",
      icon: ShieldCheck,
      items: [
        // Reporting rollups for leaders/execs (Scorecard Reports & Insights,
        // docs/plans/2026-07-01-scorecard-reports.md).
        { title: "Reports", url: "/scorecards/reports", icon: TrendingUp },
      ],
    },
    {
      title: "Self-Service",
      url: "/self-service",
      icon: Sparkles,
      // Highlight on the hub and the folded-in self-service surfaces.
      activeMatch: ["/self-service", "/templates", "/launches", "/agent", "/infra-agent"],
      items: [],
    },
    {
      // Automations bridge Scorecards (triggers) and Self-Service (actions).
      // Visible to all members (read-only); authoring is gated to workspace
      // owner/admin inside the page + server actions (P4).
      title: "Automations",
      url: "/automations",
      icon: Zap,
      items: [],
    },
    {
      title: "Workspaces",
      url: "/workspaces",
      icon: Building2,
      items: [],
    },
]

const navSettingsData = [
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    items: [
      { title: "GitHub", url: "/settings/github", icon: GitBranch },
      { title: "Registries", url: "/settings/registries", icon: Container },
      { title: "Templates", url: "/settings/templates", icon: LayoutTemplate },
      { title: "Cloud Accounts", url: "/settings/cloud-accounts", icon: Cloud },
    ],
  },
]

const navSecondaryData: { title: string; url: string; icon: typeof MessageSquare }[] = [
  // Support page hidden behind feature flag — re-enable when complete
  // { title: "Support", url: "/support", icon: LifeBuoy },
  {
    title: "Feedback",
    url: "/feedback",
    icon: MessageSquare,
  },
  // Documentation link — only shown when NEXT_PUBLIC_DOCS_URL is configured
  ...(process.env.NEXT_PUBLIC_DOCS_URL
    ? [{
        title: "Docs",
        url: process.env.NEXT_PUBLIC_DOCS_URL,
        icon: BookOpen,
      }]
    : []),
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
  {
    title: "Discovery",
    url: "/discovery",
    icon: Telescope,
  },
  {
    title: "LLM Providers",
    url: "/platform/llm-providers",
    icon: Bot,
  },
  {
    title: "Approvals",
    url: "/platform/approvals",
    icon: ShieldCheck,
  },
  {
    title: "Workflows",
    url: "/platform/workflows",
    icon: Workflow,
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
      avatar: session.user.image || '',
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
        <NavMain items={navSettingsData} label="Settings" />
        <NavPlatform items={navPlatformData} isVisible={isPlatformAdmin} />
        <NavSecondary items={navSecondaryData} className="mt-auto" />
        {isPlatformAdmin && (
          <NavSecondary items={[{ title: "Admin Panel", url: "/admin", icon: Shield }]} />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} isAdmin={isPlatformAdmin} />
      </SidebarFooter>
    </Sidebar>
  )
}