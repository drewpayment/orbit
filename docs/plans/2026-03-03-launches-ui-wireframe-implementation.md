# Launches UI Wireframe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update existing Launches UI components to match the wireframes in `docs/design.pen`, connecting them with the backend Launches feature.

**Architecture:** Modify 4 existing React components (LaunchesTable, LaunchDetail, ProviderSelector, CloudAccountsSettings) to match the wireframe designs. All data plumbing (collections, server actions, gRPC clients) is already complete — this is purely UI work.

**Tech Stack:** Next.js 15, React 19, shadcn/ui (Tabs, Breadcrumb, Table, Card, Badge), Lucide icons, Tailwind CSS

**Wireframe reference:** `docs/design.pen` — screens: CRVOC (list), ZVTUt (wizard step 1), 5XUxU (wizard step 2), HTnGy (detail), X1cVh (cloud accounts)

---

### Task 1: Add Provider Icon Helper Component

Create a small shared helper that maps provider names to Lucide icons with provider-specific colors. This is used by multiple components (LaunchesTable, LaunchDetail, ProviderSelector, CloudAccounts).

**Files:**
- Create: `orbit-www/src/components/features/launches/ProviderIcon.tsx`

**Step 1: Create the ProviderIcon component**

```tsx
import { Cloud, Server, Database, Droplets } from 'lucide-react'
import { cn } from '@/lib/utils'

const providerConfig: Record<string, { icon: React.ElementType; className: string; label: string }> = {
  aws: { icon: Cloud, className: 'text-orange-400', label: 'AWS' },
  gcp: { icon: Server, className: 'text-blue-400', label: 'GCP' },
  azure: { icon: Database, className: 'text-sky-400', label: 'Azure' },
  digitalocean: { icon: Droplets, className: 'text-blue-300', label: 'DigitalOcean' },
}

interface ProviderIconProps {
  provider: string
  size?: number
  showLabel?: boolean
  className?: string
}

export function ProviderIcon({ provider, size = 16, showLabel = false, className }: ProviderIconProps) {
  const config = providerConfig[provider] ?? { icon: Cloud, className: 'text-muted-foreground', label: provider }
  const Icon = config.icon

  if (showLabel) {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <Icon className={cn(config.className)} style={{ width: size, height: size }} />
        <span>{config.label}</span>
      </span>
    )
  }

  return <Icon className={cn(config.className, className)} style={{ width: size, height: size }} />
}

export { providerConfig }
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/launches/ProviderIcon.tsx
git commit -m "feat(launches): add ProviderIcon shared helper component"
```

---

### Task 2: Update LaunchesTable — Tab Filters and Enhanced Table Rows

Replace the Select dropdown status filter with horizontal tab buttons. Add provider icon to Provider column. Add subtitle to Name column showing linked template or "Standalone infrastructure".

**Files:**
- Modify: `orbit-www/src/components/features/launches/LaunchesTable.tsx`

**Step 1: Replace Select status filter with tab buttons**

Replace the `<Select>` component (lines 155-170) with a horizontal row of `<Button>` elements styled as tabs/pills:

```tsx
// Replace <Select> with inline pill buttons
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'launching', label: 'Launching' },
  { value: 'awaiting_approval', label: 'Awaiting Approval' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'deorbited', label: 'Deorbited' },
]

// In the filter area, replace <Select> with:
<div className="flex items-center gap-1">
  {statusOptions.map((opt) => (
    <Button
      key={opt.value}
      variant={statusFilter === opt.value ? 'secondary' : 'ghost'}
      size="sm"
      onClick={() => setStatusFilter(opt.value)}
      className="h-8 text-xs"
    >
      {opt.label}
    </Button>
  ))}
</div>
```

**Step 2: Update Provider column to use ProviderIcon**

Replace `{providerLabels[launch.provider] ?? launch.provider}` with:

```tsx
<ProviderIcon provider={launch.provider} showLabel />
```

Import `ProviderIcon` from `./ProviderIcon`.

**Step 3: Add subtitle to Name column**

Update the Name `<TableCell>` to include a subtitle line:

```tsx
<TableCell>
  <div>
    <Link href={`/launches/${launch.id}`} className="font-medium hover:underline">
      {launch.name}
    </Link>
    <div className="text-xs text-muted-foreground">
      {getTemplateName(launch.template) !== '-'
        ? getTemplateName(launch.template)
        : 'Standalone infrastructure'}
    </div>
  </div>
</TableCell>
```

**Step 4: Remove unused Select imports**

Remove `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from imports since they're no longer used.

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/launches/LaunchesTable.tsx
git commit -m "feat(launches): update table with tab filters, provider icons, and name subtitles"
```

---

### Task 3: Update LaunchDetail — Breadcrumb, Two-Column Layout, Resources Tab

Three changes: (1) Replace "Back to Launches" button with proper breadcrumb, (2) restructure Overview tab into two-column layout with Outputs on the left and Details card on the right, (3) add a 4th "Resources" tab placeholder.

**Files:**
- Modify: `orbit-www/src/components/features/launches/LaunchDetail.tsx`

**Step 1: Replace back button with Breadcrumb**

Replace the back button (lines 178-183) with:

```tsx
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

// Replace Back button with:
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/launches">Launches</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>{launch.name}</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

Remove `ArrowLeft` from lucide imports (no longer needed).

**Step 2: Add template name to metadata row**

In the metadata row (lines 192-203), add template name after the provider/region items:

```tsx
{template && (
  <span>{template.name || template.slug}</span>
)}
```

**Step 3: Restructure Overview tab into two-column layout**

Replace the single-column Overview TabsContent (lines 286-405) with a two-column grid:

```tsx
<TabsContent value="overview" className="space-y-6">
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* Left column — Outputs & Parameters (2/3 width) */}
    <div className="lg:col-span-2 space-y-6">
      {/* Pulumi Outputs card */}
      <Card>
        <CardHeader>
          <CardTitle>Outputs</CardTitle>
        </CardHeader>
        <CardContent>
          {launch.pulumiOutputs && Object.keys(launch.pulumiOutputs).length > 0 ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              {Object.entries(launch.pulumiOutputs).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-sm font-medium text-muted-foreground">{key}</dt>
                  <dd className="mt-1 font-mono text-sm break-all">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No outputs available yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Parameters card (if any) */}
      {launch.parameters && Object.keys(launch.parameters).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              {Object.entries(launch.parameters).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-sm font-medium text-muted-foreground">{key}</dt>
                  <dd className="mt-1 font-mono text-sm">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>

    {/* Right column — Details card (1/3 width) */}
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Provider</dt>
              <dd className="mt-1">{providerLabels[launch.provider] ?? launch.provider}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Region</dt>
              <dd className="mt-1 font-mono">{launch.region}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Template</dt>
              <dd className="mt-1">{template?.name || template?.slug || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Cloud Account</dt>
              <dd className="mt-1">{cloudAccount?.name || '-'}</dd>
            </div>
            {launch.pulumiStackName && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Pulumi Stack</dt>
                <dd className="mt-1 font-mono">{launch.pulumiStackName}</dd>
              </div>
            )}
            {app && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Linked App</dt>
                <dd className="mt-1">
                  <Link href={`/apps/${app.id}`} className="text-primary hover:underline">
                    {app.name || app.id}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Launched By</dt>
              <dd className="mt-1">{getUserDisplay(launch.launchedBy)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1">{formatDate(launch.createdAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Approval card (right column) */}
      {launch.approvalConfig?.required && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Timeout</dt>
                <dd className="mt-1">{launch.approvalConfig.timeoutHours || 24} hours</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Approvers</dt>
                <dd className="mt-1">
                  {launch.approvalConfig.approvers?.map((a) =>
                    getUserDisplay(a as any)
                  ).join(', ') || '-'}
                </dd>
              </div>
              {launch.approvedBy && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Approved By</dt>
                  <dd className="mt-1">{getUserDisplay(launch.approvedBy)}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  </div>
</TabsContent>
```

**Step 4: Add Resources tab**

Add a 4th tab trigger and content after `history`:

```tsx
// In TabsList:
<TabsTrigger value="resources">Resources</TabsTrigger>

// New TabsContent:
<TabsContent value="resources">
  <Card>
    <CardHeader>
      <CardTitle>Provisioned Resources</CardTitle>
    </CardHeader>
    <CardContent className="py-16 text-center text-muted-foreground">
      {status === 'active'
        ? 'Resource inventory will be available in a future update.'
        : 'Resources will appear here once the launch is active.'}
    </CardContent>
  </Card>
</TabsContent>
```

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/launches/LaunchDetail.tsx
git commit -m "feat(launches): add breadcrumb nav, two-column overview, and resources tab"
```

---

### Task 4: Update ProviderSelector — Replace Emoji Icons with Lucide Icons

Replace emoji icons in the provider selection cards with the shared ProviderIcon component.

**Files:**
- Modify: `orbit-www/src/components/features/launches/ProviderSelector.tsx`

**Step 1: Replace emoji icons with ProviderIcon**

Import `ProviderIcon` from `./ProviderIcon` and replace the emoji strings (☁️, 🌐, 🔷, 🌊) in the providers array with the component. Update the card to render `<ProviderIcon provider={p.value} size={32} />` instead of the emoji `<span className="text-3xl">`.

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/launches/ProviderSelector.tsx
git commit -m "feat(launches): replace emoji provider icons with Lucide icons"
```

---

### Task 5: Update Cloud Accounts Settings — Table Layout

Convert the card-list view into a proper Table matching the wireframe (Name, Provider, Region, Workspaces badges, Status, Actions columns).

**Files:**
- Modify: `orbit-www/src/app/(frontend)/settings/cloud-accounts/cloud-accounts-settings-client.tsx`

**Step 1: Import Table components and ProviderIcon**

Add imports for `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from `@/components/ui/table` and `ProviderIcon` from the launches feature.

**Step 2: Replace the card list with a Table**

Replace the card-based account list rendering with a `<Table>` that has columns:
- **Name** — account name
- **Provider** — ProviderIcon with label
- **Region** — default region
- **Workspaces** — Badge pills for each assigned workspace
- **Status** — existing StatusBadge (connected/disconnected/error)
- **Approval** — "Required" or "-"
- **Actions** — existing edit/delete/test dropdown menu

Keep all existing dialog/form logic unchanged — only the list rendering changes.

**Step 3: Add page-level description**

In the header section, add descriptive text: "Manage cloud provider credentials used by Launches."

**Step 4: Commit**

```bash
git add orbit-www/src/app/(frontend)/settings/cloud-accounts/cloud-accounts-settings-client.tsx
git commit -m "feat(cloud-accounts): convert card list to table layout matching wireframe"
```

---

### Task 6: Verify Build and Visual Check

**Step 1: Run TypeScript compilation check**

```bash
cd orbit-www && pnpm exec tsc --noEmit
```

Expected: No type errors.

**Step 2: Run linter**

```bash
cd orbit-www && pnpm exec next lint
```

Expected: No lint errors.

**Step 3: Commit any fixes if needed**

---

### Summary of Changes

| File | Change | Wireframe |
|------|--------|-----------|
| `ProviderIcon.tsx` | New shared component | All screens |
| `LaunchesTable.tsx` | Tab filters, provider icons, name subtitles | CRVOC |
| `LaunchDetail.tsx` | Breadcrumb, two-column layout, Resources tab | HTnGy |
| `ProviderSelector.tsx` | Lucide icons replace emoji | ZVTUt |
| `cloud-accounts-settings-client.tsx` | Card list → Table layout | X1cVh |
