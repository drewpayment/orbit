"use client"

import { usePathname } from "next/navigation"
import { type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon } from "@radix-ui/react-icons"

// activeMatch lets a nav item highlight on multiple URL prefixes — e.g.
// the "Infra Agent" entry is active both on /agent and on any
// workspace-scoped /workspaces/X/infra-agent path.
function isItemActive(pathname: string, item: { url: string; activeMatch?: string[] }): boolean {
  if (item.url === "/" ? pathname === "/" : pathname === item.url) return true
  for (const prefix of item.activeMatch ?? []) {
    if (pathname === prefix || pathname.startsWith(prefix + "/") || pathname.includes(prefix + "/")) {
      return true
    }
  }
  // Fall back to "starts with item.url" for items with sub-routes (e.g.
  // /workspaces highlights when viewing /workspaces/dogfood-test) unless
  // the item explicitly opted out via activeMatch.
  if (!item.activeMatch && item.url !== "/" && pathname.startsWith(item.url + "/")) return true
  return false
}

export function NavMain({
  items,
  label = "Platform",
}: {
  items: {
    title: string
    url: string
    icon: LucideIcon
    isActive?: boolean
    activeMatch?: string[]
    items?: {
      title: string
      url: string
    }[]
  }[]
  label?: string
}) {
  const pathname = usePathname()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const active = isItemActive(pathname ?? "", item)
          return (
          <Collapsible key={item.title} asChild defaultOpen={active}>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
                <a href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
              {item.items?.length ? (
                <>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction className="data-[state=open]:rotate-90">
                      <ChevronRightIcon />
                      <span className="sr-only">Toggle</span>
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild>
                            <a href={subItem.url}>
                              <span>{subItem.title}</span>
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : null}
            </SidebarMenuItem>
          </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
