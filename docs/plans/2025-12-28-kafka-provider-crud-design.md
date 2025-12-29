# Kafka Provider CRUD UI Design

## Overview

Add full CRUD capabilities for Kafka providers in the `/platform/kafka` admin UI. Currently providers are read-only (seeded from Go service defaults). This design adds the ability to create new provider types, edit existing ones, and delete providers.

## Context

- **Location**: `/platform/kafka` → Providers tab
- **Data source**: Payload CMS `kafka-providers` collection
- **Existing pattern**: Providers auto-seed from gRPC service on first load if Payload is empty

## Component Changes

### Files to Create

**`ProviderForm.tsx`** - Dialog-based form for create/edit

### Files to Modify

1. **`ProvidersTab.tsx`** - Add "Add Provider" button, callbacks
2. **`ProviderDetail.tsx`** - Add Delete button with AlertDialog
3. **`KafkaAdminClient.tsx`** - Add dialog state, wire up handlers

## ProviderForm Component

Dialog-based form matching the `registries-settings-client.tsx` pattern.

### Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| displayName | text | yes | Human-readable name |
| name | text | yes | Auto-generated slug from displayName, editable |
| adapterType | select | yes | Options: apache, confluent, msk |
| requiredConfigFields | tag input | yes | Array of field names (e.g., bootstrapServers) |
| capabilities | checkboxes | no | schemaRegistry, transactions, quotasApi, metricsApi |
| documentationUrl | text | no | Link to provider docs |

### Behavior

- `name` auto-generates from `displayName` (slugified: lowercase, hyphens)
- User can manually override the identifier
- Required config fields: type field name + Enter to add as tag
- Edit mode: pre-fills all fields, button text changes to "Save Changes"

### Layout

```
┌─────────────────────────────────────────────────────┐
│ Add Provider                              [X close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Display Name *                                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ My Custom Kafka                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Identifier *                    (auto-from display) │
│ ┌─────────────────────────────────────────────────┐ │
│ │ my-custom-kafka                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Adapter Type *                                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Apache Kafka                              ▼     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Required Config Fields                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [bootstrapServers] [securityProtocol] [+]       │ │
│ └─────────────────────────────────────────────────┘ │
│ Fields required when creating clusters              │
│                                                     │
│ Capabilities                                        │
│ ☑ Schema Registry    ☑ Transactions                │
│ ☐ Quotas API         ☐ Metrics API                 │
│                                                     │
│ Documentation URL                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ https://kafka.apache.org/documentation          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
├─────────────────────────────────────────────────────┤
│                        [Cancel]  [Create Provider]  │
└─────────────────────────────────────────────────────┘
```

## ProvidersTab Changes

Add header with "Add Provider" button (matches ClustersTab pattern):

```tsx
<div className="flex items-center justify-between mb-4">
  <p className="text-sm text-muted-foreground">
    {providers.length} provider{providers.length !== 1 ? 's' : ''} available
  </p>
  <div className="flex gap-2">
    <Button variant="outline" size="sm" onClick={onRefresh}>
      <RefreshCw className="h-4 w-4 mr-2" />
      Refresh
    </Button>
    <Button size="sm" onClick={onAddProvider}>
      <Plus className="h-4 w-4 mr-2" />
      Add Provider
    </Button>
  </div>
</div>
```

## ProviderDetail Changes

Add Delete button to footer with AlertDialog confirmation:

### Footer Layout

```
┌─────────────────────────────────────────────────────┐
│ [🗑 Delete Provider]              [Cancel] [Save]   │
└─────────────────────────────────────────────────────┘
```

### AlertDialog

```
┌─────────────────────────────────────────────────────┐
│ Delete Provider?                                    │
├─────────────────────────────────────────────────────┤
│ Are you sure you want to delete "Apache Kafka"?     │
│                                                     │
│ ⚠ This will affect any clusters using this          │
│   provider type.                                    │
├─────────────────────────────────────────────────────┤
│                              [Cancel] [Delete]      │
└─────────────────────────────────────────────────────┘
```

### Validation

- Before delete: check if any clusters reference this provider
- If clusters exist: show warning with count in AlertDialog

## KafkaAdminClient Changes

Add state and handlers for provider form dialog:

```tsx
// State
const [providerFormOpen, setProviderFormOpen] = useState(false)
const [editingProviderId, setEditingProviderId] = useState<string | null>(null)

// Handlers
const handleAddProvider = () => {
  setEditingProviderId(null)
  setProviderFormOpen(true)
}

const handleEditProvider = (providerId: string) => {
  setEditingProviderId(providerId)
  setProviderFormOpen(true)
}

const handleDeleteProvider = async (providerId: string) => {
  // Call deleteProvider server action
  // Refresh providers list
  // Navigate back to list
}
```

## Server Actions

Already implemented in `kafka-admin.ts`:

- `getProviders()` - lists from Payload (with auto-seed)
- `createProvider()` - creates in Payload
- `saveProviderConfig()` - updates in Payload
- `deleteProvider()` - deletes from Payload

## UI Patterns Used

Consistent with existing project patterns:

| Pattern | Source | Usage |
|---------|--------|-------|
| Dialog-based forms | registries-settings-client.tsx | ProviderForm |
| AlertDialog for delete | DeletePageDialog.tsx | ProviderDetail delete |
| Card grid display | ProvidersTab (existing) | Provider list |
| Loading states | Project-wide | Disabled buttons, "Saving..." text |
| Toast notifications | sonner | Success/error feedback |
| Tag input | Similar to template settings | Required config fields |

## Interaction Flow

```
ProvidersTab
  ├── [Add Provider] button → opens ProviderForm dialog (create mode)
  │                            └── [Create] → saves, closes dialog, refreshes list
  └── Provider Card click → ProviderDetail view
                              ├── [Save] → saves changes, back to list
                              └── [Delete] → AlertDialog → confirms → deletes, back to list
```

## Out of Scope

- Provider icon upload (can be added later)
- Provider validation/testing
- Bulk import/export of providers
