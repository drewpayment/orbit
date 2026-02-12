# Dashboard Redesign - Design Document

**Date:** 2026-02-11
**Status:** Approved
**Design Reference:** `docs/design.pen` → frame "Orbit Dashboard - Redesign"

## Problem

The current dashboard at `/dashboard` is static and unhelpful:
- Generic "Welcome to Orbit" with no personalization
- Static "Getting Started" tips and placeholder resource links (`#` hrefs)
- Flat grid of all workspaces with no context (no role, no member counts, no health)
- No visibility into applications, Kafka, APIs, or documentation activity
- No session/auth usage - shows same content to every user

## Solution

Replace with a data-rich, personalized dashboard that surfaces platform-wide metrics, user-specific workspace context, application health, recent activity, and quick actions.

## Data Fetching Architecture

Server component with parallel data fetching, following the workspace detail page pattern.

### Phase 1: Session + Payload
```typescript
const [payload, session] = await Promise.all([
  getPayloadClient(),
  getSession(),
])
```

### Phase 2: User's Workspace Memberships
```typescript
const memberships = session?.user
  ? await getUserWorkspaceMemberships(session.user.id)
  : []
const workspaceIds = memberships.map(m => getWorkspaceId(m))
```
Uses existing `getUserWorkspaceMemberships()` from `cached-queries.ts` (depth: 1, returns populated workspace objects).

### Phase 3: Parallel Aggregate Queries
All scoped to `workspace: { in: workspaceIds }`:

| Query | Collection | Method | Purpose |
|-------|-----------|--------|---------|
| App count + status | `apps` | `find` (limit 10, sort -updatedAt) | Stats card + health card |
| Kafka topic count | `kafka-topics` | `count` | Stats card |
| Virtual cluster count | `kafka-virtual-clusters` | `count` | Stats card subtitle |
| API schema count | `api-schemas` | `count` | Stats card |
| Published API count | `api-schemas` | `count` (where status=published) | Stats card subtitle |
| Recent apps | `apps` | `find` (limit 3, sort -updatedAt) | Activity feed |
| Recent topics | `kafka-topics` | `find` (limit 3, sort -createdAt) | Activity feed |
| Recent schemas | `api-schemas` | `find` (limit 3, sort -updatedAt) | Activity feed |
| Recent docs | `knowledge-pages` | `find` (limit 3, sort -updatedAt) | Activity feed |

Knowledge pages query requires first getting knowledge space IDs for user's workspaces.

## Component Architecture

All new components live in `orbit-www/src/components/features/dashboard/`.

### DashboardGreeting (Client Component)
- Props: `{ userName: string }`
- Uses `new Date().getHours()` client-side for accurate timezone
- Renders: "Good morning/afternoon/evening, {name}"
- Thresholds: morning < 12, afternoon < 17, evening otherwise

### DashboardStatsRow (Server Component)
- Props: `{ workspaceCount, appCount, healthyCount, degradedCount, kafkaTopicCount, virtualClusterCount, apiSchemaCount, publishedApiCount }`
- Renders 4 metric cards in horizontal grid
- Each card: label, icon, large number, contextual subtitle with badges

### DashboardWorkspacesCard (Server Component)
- Props: `{ memberships }` (workspace-member docs with populated workspace)
- Renders list with: letter avatar (color-coded), workspace name, meta line (app count · member count · status), role badge (owner=green, admin=blue, member=muted)
- "View all →" link to `/workspaces`

### DashboardAppHealthCard (Server Component)
- Props: `{ apps }` (recent apps with status)
- Renders list with: status dot (green/yellow/red/gray), app name, workspace · version meta, health badge
- "View all →" link to `/apps`

### DashboardActivityFeed (Server Component)
- Props: `{ activities: Activity[] }` (normalized, sorted)
- Activity type: `{ type: 'app'|'topic'|'schema'|'doc', title, description, timestamp, color }`
- Color mapping: app=green, topic=blue, schema=purple, doc=green, warning=yellow
- Relative timestamps via `formatDistanceToNow` (date-fns)
- Shows top 5 items

### DashboardQuickActions (Server Component)
- Static component, no props needed
- 5 action links with color-coded icon backgrounds:
  - Create Application (orange) → `/apps/new`
  - Request Kafka Topic (blue) → context-dependent
  - Register API Schema (green) → `/catalog/apis`
  - Write Documentation (purple) → context-dependent
  - Use Template (yellow) → `/templates`

## Layout

```
┌──────────────────────────────────────────────────────┐
│ Sidebar │ Header Bar (breadcrumb + search)            │
│         ├────────────────────────────────────────────│
│         │ Welcome Section (greeting + action buttons) │
│         │                                            │
│         │ ┌────────┐┌────────┐┌────────┐┌────────┐  │
│         │ │Workspcs││  Apps  ││ Kafka  ││  APIs  │  │
│         │ │   6    ││   23   ││   47   ││   12   │  │
│         │ └────────┘└────────┘└────────┘└────────┘  │
│         │                                            │
│         │ ┌─────────────────┐ ┌──────────────────┐   │
│         │ │ My Workspaces   │ │ Recent Activity  │   │
│         │ │ · Engineering   │ │ · App deployed   │   │
│         │ │ · Digital       │ │ · Topic created  │   │
│         │ │ · Alice's WS    │ │ · Schema added   │   │
│         │ ├─────────────────┤ ├──────────────────┤   │
│         │ │ App Health      │ │ Quick Actions    │   │
│         │ │ · payment-svc   │ │ · Create App     │   │
│         │ │ · user-auth-api │ │ · Kafka Topic    │   │
│         │ │ · order-proc    │ │ · API Schema     │   │
│         │ └─────────────────┘ └──────────────────┘   │
└──────────────────────────────────────────────────────┘
```

Responsive: 2-col → 1-col at `lg:`, 4-stat → 2-stat at `md:`.

## Styling

- Uses existing Tailwind design tokens (`bg-card`, `border`, `text-foreground`, etc.)
- Cards: `rounded-lg border bg-card`
- Status badges: semantic colors at 10% opacity backgrounds
- Entrance animations via existing `.stagger-reveal` / `.stagger-item` CSS
- Inter font throughout (project default)
- Lucide icons matching sidebar icon set
