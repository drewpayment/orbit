# Consumer Connection Information Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Display connection details to consumers after a topic share is approved, so they know how to connect to shared Kafka topics through Bifrost.

**Architecture:** Server action fetches share details and Bifrost config, assembles connection info. React components render bootstrap server, topic name, service account credentials, and code snippets. Configuration stored in Payload CMS collection for admin control.

**Tech Stack:** Next.js 15, React 19, Payload CMS 3.0, TypeScript, shadcn/ui

---

## Overview

When a consumer's topic share request is approved, they need to know:
- Where to connect (bootstrap servers)
- What topic name to use
- How to authenticate
- What credentials to use

This feature provides that information in a clean, copy-friendly UI with ready-to-use code snippets.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to show | TopicCatalog + SharedTopicsList | Consumers see it where they browse; owners can help debug |
| Bootstrap server source | Bifrost gateway (configurable) | Users connect through proxy, never need physical details |
| Topic name displayed | Short name | Bifrost handles rewriting; users use simple names |
| Consumer groups | Short name | Same as topics - Bifrost rewrites with VC prefix |
| Service accounts | From consumer's application | Each app manages its own credentials |
| Code snippets | Java, Python, Node.js, Go | Most common Kafka client languages |
| Configuration | BifrostConfig collection | Admin-configurable without redeployment |
| Connection mode | Bifrost-first, direct optional | Future-proofs for clusters that bypass proxy |

## UI Components

### 1. ConnectionDetailsPanel

Main panel showing all connection information.

**Location:** Slide-over or modal, triggered from TopicCatalog and SharedTopicsList

**Visual:**

```
┌─────────────────────────────────────────────────────────┐
│ Connection Details                                      │
├─────────────────────────────────────────────────────────┤
│ Bootstrap Servers:  kafka.bifrost.orbit.io:9092         │
│ Topic Name:         order-events                        │
│ Auth Method:        SASL/SCRAM-SHA-256                  │
│                                                         │
│ Service Account                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ my-consumer-app (Active)                    [Copy]  │ │
│ │ Username: sa-abc123                                 │ │
│ │ Password: ••••••••••••••••          [Show] [Copy]   │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [View Code Snippets]                                    │
└─────────────────────────────────────────────────────────┘
```

**Props:**

```typescript
interface ConnectionDetailsPanelProps {
  shareId: string
  onClose?: () => void
}
```

### 2. ServiceAccountSelector

Dropdown/list of service accounts with credential display.

**Scenario A - Multiple accounts exist:**

```
┌─────────────────────────────────────────────────────────┐
│ Service Account                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Select account: [my-consumer-app ▼]                 │ │
│ │                                                     │ │
│ │ • my-consumer-app (Active)                          │ │
│ │ • analytics-worker (Active)                         │ │
│ │ • batch-processor (Inactive)                        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [+ Create New Service Account]                          │
└─────────────────────────────────────────────────────────┘
```

**Scenario B - No accounts exist:**

```
┌─────────────────────────────────────────────────────────┐
│ Service Account                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ⚠️ No service accounts configured                   │ │
│ │                                                     │ │
│ │ Create a service account to connect to this topic.  │ │
│ │                                                     │ │
│ │ [Create Service Account]                            │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Props:**

```typescript
interface ServiceAccountSelectorProps {
  serviceAccounts: ServiceAccount[]
  applicationId: string
  applicationName: string
}
```

### 3. CodeSnippetsDialog

Modal with tabbed code examples for each language.

**Visual:**

```
┌─────────────────────────────────────────────────────────┐
│ Code Snippets                                     [×]   │
├─────────────────────────────────────────────────────────┤
│ [Java] [Python] [Node.js] [Go]                          │
├─────────────────────────────────────────────────────────┤
│ // Node.js - KafkaJS                                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ const { Kafka } = require('kafkajs')                │ │
│ │                                                     │ │
│ │ const kafka = new Kafka({                           │ │
│ │   clientId: 'my-consumer-app',                      │ │
│ │   brokers: ['kafka.bifrost.orbit.io:9092'],         │ │
│ │   ssl: true,                                        │ │
│ │   sasl: {                                           │ │
│ │     mechanism: 'scram-sha-256',                     │ │
│ │     username: 'sa-abc123',                          │ │
│ │     password: process.env.KAFKA_PASSWORD,           │ │
│ │   },                                                │ │
│ │ })                                                  │ │
│ │                                                     │ │
│ │ const consumer = kafka.consumer({                   │ │
│ │   groupId: 'my-consumer-group'                      │ │
│ │ })                                                  │ │
│ │                                                     │ │
│ │ await consumer.subscribe({                          │ │
│ │   topic: 'order-events'                             │ │
│ │ })                                                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                            [Copy Code]  │
│                                                         │
│ ⚠️ Never commit credentials. Use environment variables. │
└─────────────────────────────────────────────────────────┘
```

**Props:**

```typescript
interface CodeSnippetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionDetails: {
    bootstrapServers: string
    topicName: string
    username: string
    authMethod: string
    tlsEnabled: boolean
  }
}
```

**Supported languages:**
- Java (kafka-clients)
- Python (confluent-kafka)
- Node.js (kafkajs)
- Go (segmentio/kafka-go)

## Data Model

### BifrostConfig Collection (New)

Platform-level configuration for Bifrost connection settings.

```typescript
// collections/BifrostConfig.ts
{
  slug: 'bifrost-config',
  admin: {
    group: 'Platform',
    useAsTitle: 'name',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      defaultValue: 'Default',
      admin: { readOnly: true },
    },
    {
      name: 'advertisedHost',
      type: 'text',
      required: true,
      label: 'Bifrost Advertised Host',
      admin: {
        description: 'The hostname:port clients use to connect (e.g., kafka.bifrost.orbit.io:9092)',
      },
    },
    {
      name: 'defaultAuthMethod',
      type: 'select',
      required: true,
      defaultValue: 'SASL/SCRAM-SHA-256',
      options: [
        { label: 'SCRAM-SHA-256', value: 'SASL/SCRAM-SHA-256' },
        { label: 'SCRAM-SHA-512', value: 'SASL/SCRAM-SHA-512' },
        { label: 'PLAIN', value: 'SASL/PLAIN' },
      ],
    },
    {
      name: 'connectionMode',
      type: 'select',
      required: true,
      defaultValue: 'bifrost',
      label: 'Connection Mode',
      options: [
        { label: 'Bifrost Proxy', value: 'bifrost' },
        { label: 'Direct to Cluster', value: 'direct' },
      ],
      admin: {
        description: 'Bifrost: clients connect through proxy. Direct: clients connect to physical cluster.',
      },
    },
    {
      name: 'tlsEnabled',
      type: 'checkbox',
      defaultValue: true,
      label: 'TLS Enabled',
      admin: {
        description: 'Whether client connections require TLS',
      },
    },
  ],
}
```

### Data Flow

```
TopicShare (approved)
    │
    ├── topic → KafkaTopic
    │              └── name (short name displayed to user)
    │
    └── requestingApplication → KafkaApplication
                   └── serviceAccounts → KafkaServiceAccounts[]
                           ├── username
                           └── password (encrypted)

BifrostConfig (singleton)
    ├── advertisedHost
    ├── defaultAuthMethod
    ├── connectionMode
    └── tlsEnabled
```

## Server Actions

### getConnectionDetails

```typescript
// app/actions/kafka-topic-catalog.ts

export async function getConnectionDetails(shareId: string): Promise<{
  bootstrapServers: string
  topicName: string
  authMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  tlsEnabled: boolean
  serviceAccounts: Array<{
    id: string
    name: string
    username: string
    password: string
    status: 'active' | 'inactive'
  }>
  applicationId: string
  applicationName: string
}>
```

**Logic:**
1. Fetch the share record with `topic` and `requestingApplication` populated
2. Verify current user has access (owns the topic OR is the requester)
3. Get BifrostConfig from collection (singleton)
4. If connectionMode is 'direct', use physical cluster's bootstrap servers
5. Fetch service accounts for the requesting application
6. Return assembled connection details

**Access control:**
- Topic owner can view (to help consumers debug)
- Share requester can view (to connect)
- Others get 403

### getBifrostConfig (helper)

```typescript
// lib/bifrost-config.ts

export async function getBifrostConfig(): Promise<BifrostConfig> {
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'bifrost-config',
    limit: 1,
  })

  if (result.docs.length === 0) {
    // Return defaults if not configured
    return {
      advertisedHost: 'localhost:9092',
      defaultAuthMethod: 'SASL/SCRAM-SHA-256',
      connectionMode: 'bifrost',
      tlsEnabled: true,
    }
  }

  return result.docs[0]
}
```

## UI Integration Points

### 1. TopicCatalog Page

**Location:** `/workspaces/[slug]/kafka/catalog`

Add "Connect" button for topics with approved shares:

```
│ Topic              Owner           Status      Actions          │
├─────────────────────────────────────────────────────────────────┤
│ order-events       team-commerce   ✅ Approved  [Connect] [...]  │
│ user-activity      team-analytics  ⏳ Pending   [...]            │
```

- "Connect" button only appears when `share.status === 'approved'`
- Clicking opens `ConnectionDetailsPanel` in a Sheet (slide-over)

### 2. SharedTopicsList Component

**Location:** Topic detail page, shares tab

Add "View Connection Details" for approved outgoing shares:

```
│ Consumer              Status      Actions                       │
├─────────────────────────────────────────────────────────────────┤
│ analytics-app         ✅ Approved  [View Connection Details]     │
│ reporting-service     ✅ Approved  [View Connection Details]     │
│ new-consumer          ⏳ Pending   [Approve] [Reject]            │
```

### 3. Post-Approval Toast (Optional)

When a share is approved, show notification with quick link:

```
┌─────────────────────────────────────────────────────┐
│ ✅ Access approved to order-events                  │
│                                                     │
│ [View Connection Details]  [Dismiss]                │
└─────────────────────────────────────────────────────┘
```

## Error States

### Share not approved

```
⏳ Access Pending

Your request to access this topic is awaiting approval.
You'll be able to connect once the owner approves.

Requested: Jan 15, 2026
```

### Share revoked

```
❌ Access Revoked

Your access to this topic has been revoked.
Contact the topic owner to request access again.

Revoked: Jan 17, 2026
```

### No service accounts

```
⚠️ No service accounts configured

Create a service account to connect to this topic.

[Create Service Account]
```

### No permission to create service accounts

```
⚠️ No service accounts available

Your application has no service accounts configured.
Contact your workspace admin to create one.
```

### Bifrost not configured

```
⚙️ Configuration Required

Kafka connection settings have not been configured.
Please contact your platform administrator.
```

### Topic not provisioned (direct mode)

```
⚠️ Topic not fully provisioned

This topic doesn't have a physical cluster assignment.
Connection details will be available once provisioning completes.
```

## File Structure

### New Files

```
orbit-www/src/
├── collections/
│   └── BifrostConfig.ts                # New collection
│
├── lib/
│   └── bifrost-config.ts               # Config helper
│
├── components/features/kafka/
│   ├── ConnectionDetailsPanel.tsx      # Main panel
│   ├── ServiceAccountSelector.tsx      # Credentials display
│   ├── CodeSnippetsDialog.tsx          # Code examples modal
│   └── code-snippets/
│       ├── index.ts                    # Export all templates
│       ├── java-template.ts            # Java snippet
│       ├── python-template.ts          # Python snippet
│       ├── nodejs-template.ts          # Node.js snippet
│       └── go-template.ts              # Go snippet
│
├── components/ui/
│   └── secret-field.tsx                # Password field (if needed)
```

### Modified Files

```
orbit-www/src/
├── payload.config.ts                   # Register BifrostConfig collection
│
├── app/actions/
│   └── kafka-topic-catalog.ts          # Add getConnectionDetails
│
├── app/(frontend)/workspaces/[slug]/kafka/catalog/
│   └── page.tsx                        # Add Connect button
│
├── components/features/kafka/
│   └── SharedTopicsList.tsx            # Add View Connection Details
```

## Future Considerations

### Direct Mode Support

When `connectionMode === 'direct'`:
- Bootstrap servers come from `KafkaCluster.bootstrapServers`
- Topic name shows `physicalName` instead of short name
- Consumer groups need full prefixed name
- Code snippets adjust accordingly

### Multiple Bifrost Instances

If needed per-cluster or per-environment:
- Change BifrostConfig from singleton to per-cluster relationship
- Or add `KafkaCluster.bifrostHost` field
- Server action checks cluster's Bifrost config first, falls back to global

### Auto-Create Service Account on Approval

Future enhancement:
- When share is approved, optionally auto-create a service account
- Reduces friction for consumers
- Would require approval workflow to trigger Temporal workflow

---

## Implementation Checklist

- [ ] Create BifrostConfig collection
- [ ] Register collection in payload.config.ts
- [ ] Create getBifrostConfig helper
- [ ] Create getConnectionDetails server action
- [ ] Create ConnectionDetailsPanel component
- [ ] Create ServiceAccountSelector component
- [ ] Create CodeSnippetsDialog component
- [ ] Create code snippet templates (4 languages)
- [ ] Create SecretField component (if needed)
- [ ] Integrate into TopicCatalog page
- [ ] Integrate into SharedTopicsList component
- [ ] Add error state handling
- [ ] Write tests for server action
- [ ] Write tests for components
