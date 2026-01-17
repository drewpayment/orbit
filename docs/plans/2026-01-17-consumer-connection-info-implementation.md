# Consumer Connection Information Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display connection details to consumers after topic share approval, showing bootstrap servers, topic name, auth method, and service account credentials.

**Architecture:** BifrostConfig collection stores admin-configurable connection settings. Server action fetches share + config and returns connection details. React components (ConnectionDetailsPanel, ServiceAccountSelector, CodeSnippetsDialog) display the info in a Sheet slide-over.

**Tech Stack:** Next.js 15, React 19, Payload CMS 3.0, TypeScript, shadcn/ui (Sheet, Tabs, Select)

---

## Task 1: Create BifrostConfig Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/BifrostConfig.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Write the collection file**

Create `orbit-www/src/collections/kafka/BifrostConfig.ts`:

```typescript
import type { CollectionConfig } from 'payload'

export const BifrostConfig: CollectionConfig = {
  slug: 'bifrost-config',
  admin: {
    useAsTitle: 'name',
    group: 'Platform',
    description: 'Bifrost gateway connection settings for Kafka clients',
  },
  access: {
    // Only admins can read/write this singleton
    read: ({ req: { user } }) => {
      if (!user) return false
      // System users (admins) have full access
      return user.collection === 'users'
    },
    create: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    update: ({ req: { user } }) => {
      if (!user) return false
      return user.collection === 'users'
    },
    delete: () => false, // Prevent deletion of singleton
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      defaultValue: 'Default',
      admin: {
        readOnly: true,
        description: 'Configuration name (singleton)',
      },
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
      admin: {
        description: 'Default authentication method for Kafka clients',
      },
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
  timestamps: true,
}
```

**Step 2: Export from kafka index**

Add to `orbit-www/src/collections/kafka/index.ts` after the Platform-level exports:

```typescript
// Platform-level resources (admin managed)
export { KafkaProviders } from './KafkaProviders'
export { KafkaClusters } from './KafkaClusters'
export { KafkaEnvironmentMappings } from './KafkaEnvironmentMappings'
export { BifrostConfig } from './BifrostConfig'
```

**Step 3: Register in payload.config.ts**

Add to the imports in `orbit-www/src/payload.config.ts`:

```typescript
import {
  KafkaProviders,
  KafkaClusters,
  KafkaEnvironmentMappings,
  BifrostConfig,  // Add this
  // ... rest of imports
} from './collections/kafka'
```

Add to collections array after KafkaEnvironmentMappings:

```typescript
collections: [
  // ... existing collections
  KafkaEnvironmentMappings,
  BifrostConfig,  // Add this
  KafkaApplications,
  // ...
]
```

**Step 4: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/BifrostConfig.ts orbit-www/src/collections/kafka/index.ts orbit-www/src/payload.config.ts
git commit -m "feat(kafka): add BifrostConfig collection for connection settings"
```

---

## Task 2: Create getBifrostConfig Helper

**Files:**
- Create: `orbit-www/src/lib/bifrost-config.ts`
- Test: `orbit-www/src/lib/bifrost-config.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/lib/bifrost-config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

describe('getBifrostConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config from database when exists', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({
        docs: [{
          id: '1',
          advertisedHost: 'kafka.example.com:9092',
          defaultAuthMethod: 'SASL/SCRAM-SHA-256',
          connectionMode: 'bifrost',
          tlsEnabled: true,
        }],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.advertisedHost).toBe('kafka.example.com:9092')
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-256')
    expect(config.connectionMode).toBe('bifrost')
    expect(config.tlsEnabled).toBe(true)
  })

  it('returns defaults when no config exists', async () => {
    const { getPayload } = await import('payload')
    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const { getBifrostConfig } = await import('./bifrost-config')
    const config = await getBifrostConfig()

    expect(config.advertisedHost).toBe('localhost:9092')
    expect(config.defaultAuthMethod).toBe('SASL/SCRAM-SHA-256')
    expect(config.connectionMode).toBe('bifrost')
    expect(config.tlsEnabled).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/bifrost-config.test.ts`
Expected: FAIL with "Cannot find module './bifrost-config'"

**Step 3: Write the implementation**

Create `orbit-www/src/lib/bifrost-config.ts`:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'

export type BifrostConfigData = {
  advertisedHost: string
  defaultAuthMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  connectionMode: 'bifrost' | 'direct'
  tlsEnabled: boolean
}

const DEFAULT_CONFIG: BifrostConfigData = {
  advertisedHost: 'localhost:9092',
  defaultAuthMethod: 'SASL/SCRAM-SHA-256',
  connectionMode: 'bifrost',
  tlsEnabled: true,
}

export async function getBifrostConfig(): Promise<BifrostConfigData> {
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'bifrost-config',
    limit: 1,
    overrideAccess: true,
  })

  if (result.docs.length === 0) {
    return DEFAULT_CONFIG
  }

  const doc = result.docs[0]
  return {
    advertisedHost: doc.advertisedHost || DEFAULT_CONFIG.advertisedHost,
    defaultAuthMethod: (doc.defaultAuthMethod as BifrostConfigData['defaultAuthMethod']) || DEFAULT_CONFIG.defaultAuthMethod,
    connectionMode: (doc.connectionMode as BifrostConfigData['connectionMode']) || DEFAULT_CONFIG.connectionMode,
    tlsEnabled: doc.tlsEnabled ?? DEFAULT_CONFIG.tlsEnabled,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/lib/bifrost-config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/lib/bifrost-config.ts orbit-www/src/lib/bifrost-config.test.ts
git commit -m "feat(kafka): add getBifrostConfig helper for connection settings"
```

---

## Task 3: Create getConnectionDetails Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-topic-catalog.ts`
- Test: `orbit-www/src/app/actions/kafka-topic-catalog.test.ts`

**Step 1: Add type definitions to kafka-topic-catalog.ts**

Add after existing type definitions (around line 65):

```typescript
export type ConnectionDetails = {
  bootstrapServers: string
  topicName: string
  authMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  tlsEnabled: boolean
  serviceAccounts: Array<{
    id: string
    name: string
    username: string
    status: 'active' | 'revoked'
  }>
  applicationId: string
  applicationName: string
  shareStatus: string
}

export type GetConnectionDetailsResult = {
  success: boolean
  connectionDetails?: ConnectionDetails
  error?: string
}
```

**Step 2: Add the server action**

Add after the existing server actions (at end of file):

```typescript
/**
 * Get connection details for an approved topic share
 *
 * Returns bootstrap servers, topic name, auth method, and service accounts
 * for connecting to a shared topic.
 */
export async function getConnectionDetails(
  shareId: string
): Promise<GetConnectionDetailsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Fetch the share with related data
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: shareId,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Get workspace IDs
    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id
    const targetWorkspaceId = typeof share.targetWorkspace === 'string'
      ? share.targetWorkspace
      : share.targetWorkspace.id

    // Verify user has access (member of owner or target workspace)
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: userId } },
          { status: { equals: 'active' } },
          {
            or: [
              { workspace: { equals: ownerWorkspaceId } },
              { workspace: { equals: targetWorkspaceId } },
            ],
          },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (memberships.docs.length === 0) {
      return { success: false, error: 'Access denied' }
    }

    // Get topic details
    const topic = typeof share.topic === 'string'
      ? await payload.findByID({ collection: 'kafka-topics', id: share.topic, overrideAccess: true })
      : share.topic

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    // Get Bifrost config
    const { getBifrostConfig } = await import('@/lib/bifrost-config')
    const bifrostConfig = await getBifrostConfig()

    // Determine bootstrap servers and topic name based on connection mode
    let bootstrapServers: string
    let topicName: string

    if (bifrostConfig.connectionMode === 'bifrost') {
      bootstrapServers = bifrostConfig.advertisedHost
      topicName = topic.name // Short name - Bifrost rewrites
    } else {
      // Direct mode - use physical cluster details
      const cluster = typeof topic.cluster === 'string'
        ? await payload.findByID({ collection: 'kafka-clusters', id: topic.cluster, overrideAccess: true })
        : topic.cluster

      bootstrapServers = cluster?.bootstrapServers || bifrostConfig.advertisedHost
      topicName = topic.fullTopicName || topic.name
    }

    // Find the requesting application to get service accounts
    // First, find applications in the target workspace
    const apps = await payload.find({
      collection: 'kafka-applications',
      where: {
        workspace: { equals: targetWorkspaceId },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Get service accounts for these applications
    const appIds = apps.docs.map(a => a.id)
    const serviceAccountsResult = await payload.find({
      collection: 'kafka-service-accounts',
      where: {
        and: [
          { application: { in: appIds } },
          { status: { equals: 'active' } },
        ],
      },
      depth: 1,
      limit: 100,
      overrideAccess: true,
    })

    const serviceAccounts = serviceAccountsResult.docs.map(sa => {
      const app = typeof sa.application === 'string'
        ? apps.docs.find(a => a.id === sa.application)
        : sa.application

      return {
        id: sa.id,
        name: sa.name,
        username: sa.username,
        status: sa.status as 'active' | 'revoked',
        applicationName: app?.name || 'Unknown',
      }
    })

    // Get first app for display (or use target workspace info)
    const primaryApp = apps.docs[0]

    return {
      success: true,
      connectionDetails: {
        bootstrapServers,
        topicName,
        authMethod: bifrostConfig.defaultAuthMethod,
        tlsEnabled: bifrostConfig.tlsEnabled,
        serviceAccounts,
        applicationId: primaryApp?.id || '',
        applicationName: primaryApp?.name || 'No application',
        shareStatus: share.status,
      },
    }
  } catch (error) {
    console.error('Failed to get connection details:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

**Step 3: Add import for getBifrostConfig at top of file**

The dynamic import is used in the function body, so no top-level import needed.

**Step 4: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-catalog.ts
git commit -m "feat(kafka): add getConnectionDetails server action"
```

---

## Task 4: Create Code Snippet Templates

**Files:**
- Create: `orbit-www/src/components/features/kafka/code-snippets/index.ts`
- Create: `orbit-www/src/components/features/kafka/code-snippets/java-template.ts`
- Create: `orbit-www/src/components/features/kafka/code-snippets/python-template.ts`
- Create: `orbit-www/src/components/features/kafka/code-snippets/nodejs-template.ts`
- Create: `orbit-www/src/components/features/kafka/code-snippets/go-template.ts`

**Step 1: Create the templates directory and index**

Create `orbit-www/src/components/features/kafka/code-snippets/index.ts`:

```typescript
export type CodeSnippetParams = {
  bootstrapServers: string
  topicName: string
  username: string
  authMethod: string
  tlsEnabled: boolean
}

export { generateJavaSnippet } from './java-template'
export { generatePythonSnippet } from './python-template'
export { generateNodejsSnippet } from './nodejs-template'
export { generateGoSnippet } from './go-template'
```

**Step 2: Create Java template**

Create `orbit-www/src/components/features/kafka/code-snippets/java-template.ts`:

```typescript
import type { CodeSnippetParams } from './index'

export function generateJavaSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '')

  return `// Java - Apache Kafka Client
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import java.time.Duration;
import java.util.*;

Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "${params.bootstrapServers}");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "my-consumer-group");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

// Authentication
props.put("security.protocol", "${params.tlsEnabled ? 'SASL_SSL' : 'SASL_PLAINTEXT'}");
props.put("sasl.mechanism", "${mechanism}");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\\"${params.username}\\" " +
    "password=\\"" + System.getenv("KAFKA_PASSWORD") + "\\";");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("${params.topicName}"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        System.out.printf("offset=%d, key=%s, value=%s%n",
            record.offset(), record.key(), record.value());
    }
}`
}
```

**Step 3: Create Python template**

Create `orbit-www/src/components/features/kafka/code-snippets/python-template.ts`:

```typescript
import type { CodeSnippetParams } from './index'

export function generatePythonSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '_')

  return `# Python - confluent-kafka
import os
from confluent_kafka import Consumer

config = {
    'bootstrap.servers': '${params.bootstrapServers}',
    'group.id': 'my-consumer-group',
    'auto.offset.reset': 'earliest',
    # Authentication
    'security.protocol': '${params.tlsEnabled ? 'SASL_SSL' : 'SASL_PLAINTEXT'}',
    'sasl.mechanism': '${mechanism}',
    'sasl.username': '${params.username}',
    'sasl.password': os.environ.get('KAFKA_PASSWORD'),
}

consumer = Consumer(config)
consumer.subscribe(['${params.topicName}'])

try:
    while True:
        msg = consumer.poll(timeout=1.0)
        if msg is None:
            continue
        if msg.error():
            print(f"Consumer error: {msg.error()}")
            continue
        print(f"Received: {msg.value().decode('utf-8')}")
finally:
    consumer.close()`
}
```

**Step 4: Create Node.js template**

Create `orbit-www/src/components/features/kafka/code-snippets/nodejs-template.ts`:

```typescript
import type { CodeSnippetParams } from './index'

export function generateNodejsSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').toLowerCase().replace('-', '-')

  return `// Node.js - KafkaJS
const { Kafka } = require('kafkajs')

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['${params.bootstrapServers}'],
  ssl: ${params.tlsEnabled},
  sasl: {
    mechanism: '${mechanism}',
    username: '${params.username}',
    password: process.env.KAFKA_PASSWORD,
  },
})

const consumer = kafka.consumer({ groupId: 'my-consumer-group' })

async function run() {
  await consumer.connect()
  await consumer.subscribe({ topic: '${params.topicName}', fromBeginning: true })

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log({
        topic,
        partition,
        offset: message.offset,
        value: message.value.toString(),
      })
    },
  })
}

run().catch(console.error)`
}
```

**Step 5: Create Go template**

Create `orbit-www/src/components/features/kafka/code-snippets/go-template.ts`:

```typescript
import type { CodeSnippetParams } from './index'

export function generateGoSnippet(params: CodeSnippetParams): string {
  const mechanism = params.authMethod.replace('SASL/', '').replace('-', '')

  return `// Go - segmentio/kafka-go
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/scram"
)

func main() {
	mechanism, _ := scram.Mechanism(scram.SHA256, "${params.username}", os.Getenv("KAFKA_PASSWORD"))

	dialer := &kafka.Dialer{
		SASLMechanism: mechanism,
		TLS:           ${params.tlsEnabled ? '&tls.Config{}' : 'nil'},
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{"${params.bootstrapServers}"},
		Topic:   "${params.topicName}",
		GroupID: "my-consumer-group",
		Dialer:  dialer,
	})
	defer reader.Close()

	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			fmt.Printf("Error: %v\\n", err)
			break
		}
		fmt.Printf("Message at offset %d: %s\\n", msg.Offset, string(msg.Value))
	}
}`
}
```

**Step 6: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add orbit-www/src/components/features/kafka/code-snippets/
git commit -m "feat(kafka): add code snippet templates for Java, Python, Node.js, Go"
```

---

## Task 5: Create ServiceAccountSelector Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/ServiceAccountSelector.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/features/kafka/ServiceAccountSelector.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Copy, Check, Eye, EyeOff, Plus } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export type ServiceAccountInfo = {
  id: string
  name: string
  username: string
  status: 'active' | 'revoked'
  applicationName?: string
}

interface ServiceAccountSelectorProps {
  serviceAccounts: ServiceAccountInfo[]
  applicationId: string
  workspaceSlug: string
  onPasswordRequest?: (accountId: string) => Promise<string | null>
}

export function ServiceAccountSelector({
  serviceAccounts,
  applicationId,
  workspaceSlug,
  onPasswordRequest,
}: ServiceAccountSelectorProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    serviceAccounts.length > 0 ? serviceAccounts[0].id : ''
  )
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [loadingPassword, setLoadingPassword] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const selectedAccount = serviceAccounts.find(sa => sa.id === selectedAccountId)
  const activeAccounts = serviceAccounts.filter(sa => sa.status === 'active')

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleLoadPassword = async () => {
    if (!onPasswordRequest || !selectedAccountId) return
    setLoadingPassword(true)
    try {
      const pwd = await onPasswordRequest(selectedAccountId)
      setPassword(pwd)
    } catch {
      toast.error('Failed to load password')
    } finally {
      setLoadingPassword(false)
    }
  }

  if (activeAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-yellow-800 dark:text-yellow-200">
              No service accounts configured
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Create a service account to connect to this topic.
            </p>
            <Link
              href={`/workspaces/${workspaceSlug}/kafka/applications/${applicationId}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline mt-2"
            >
              <Plus className="h-4 w-4" />
              Create Service Account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Service Account</Label>
        <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a service account" />
          </SelectTrigger>
          <SelectContent>
            {activeAccounts.map(account => (
              <SelectItem key={account.id} value={account.id}>
                <div className="flex items-center gap-2">
                  <span>{account.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {account.status}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedAccount && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{selectedAccount.name}</span>
            <Badge
              variant="outline"
              className={selectedAccount.status === 'active' ? 'border-green-500 text-green-600' : ''}
            >
              {selectedAccount.status}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Username</Label>
            <div className="flex gap-2">
              <Input value={selectedAccount.username} readOnly className="font-mono text-sm" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(selectedAccount.username, 'username')}
              >
                {copiedField === 'username' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Password</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password || '••••••••••••••••'}
                  readOnly
                  className="font-mono text-sm pr-10"
                />
                {password && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              {password ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(password, 'password')}
                >
                  {copiedField === 'password' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleLoadPassword}
                  disabled={loadingPassword || !onPasswordRequest}
                >
                  {loadingPassword ? 'Loading...' : 'Show'}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Password is only shown once. Store it securely.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href={`/workspaces/${workspaceSlug}/kafka/applications/${applicationId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Manage service accounts
        </Link>
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/ServiceAccountSelector.tsx
git commit -m "feat(kafka): add ServiceAccountSelector component"
```

---

## Task 6: Create CodeSnippetsDialog Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/CodeSnippetsDialog.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/features/kafka/CodeSnippetsDialog.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Copy, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  generateJavaSnippet,
  generatePythonSnippet,
  generateNodejsSnippet,
  generateGoSnippet,
  type CodeSnippetParams,
} from './code-snippets'

interface CodeSnippetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionDetails: CodeSnippetParams
}

const languages = [
  { id: 'nodejs', label: 'Node.js', generator: generateNodejsSnippet },
  { id: 'python', label: 'Python', generator: generatePythonSnippet },
  { id: 'java', label: 'Java', generator: generateJavaSnippet },
  { id: 'go', label: 'Go', generator: generateGoSnippet },
] as const

export function CodeSnippetsDialog({
  open,
  onOpenChange,
  connectionDetails,
}: CodeSnippetsDialogProps) {
  const [activeTab, setActiveTab] = useState<string>('nodejs')
  const [copied, setCopied] = useState(false)

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Code copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy code')
    }
  }

  const activeLanguage = languages.find(l => l.id === activeTab)
  const code = activeLanguage?.generator(connectionDetails) || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Code Snippets</DialogTitle>
          <DialogDescription>
            Ready-to-use code for connecting to {connectionDetails.topicName}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-4">
            {languages.map(lang => (
              <TabsTrigger key={lang.id} value={lang.id}>
                {lang.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {languages.map(lang => (
            <TabsContent
              key={lang.id}
              value={lang.id}
              className="flex-1 overflow-hidden flex flex-col mt-4"
            >
              <div className="relative flex-1 overflow-auto rounded-lg border bg-muted">
                <pre className="p-4 text-sm overflow-x-auto">
                  <code>{lang.generator(connectionDetails)}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => copyCode(lang.generator(connectionDetails))}
                >
                  {copied && activeTab === lang.id ? (
                    <>
                      <Check className="h-4 w-4 mr-1 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <Alert variant="default" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Never commit credentials to version control. Use environment variables for the password.
          </AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/CodeSnippetsDialog.tsx
git commit -m "feat(kafka): add CodeSnippetsDialog component with language tabs"
```

---

## Task 7: Create ConnectionDetailsPanel Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/ConnectionDetailsPanel.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/features/kafka/ConnectionDetailsPanel.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Copy, Check, Code, Clock, XCircle, AlertTriangle, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { getConnectionDetails, type ConnectionDetails } from '@/app/actions/kafka-topic-catalog'
import { ServiceAccountSelector, type ServiceAccountInfo } from './ServiceAccountSelector'
import { CodeSnippetsDialog } from './CodeSnippetsDialog'

interface ConnectionDetailsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shareId: string
  workspaceSlug: string
}

export function ConnectionDetailsPanel({
  open,
  onOpenChange,
  shareId,
  workspaceSlug,
}: ConnectionDetailsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [codeSnippetsOpen, setCodeSnippetsOpen] = useState(false)

  useEffect(() => {
    if (open && shareId) {
      loadConnectionDetails()
    }
  }, [open, shareId])

  const loadConnectionDetails = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getConnectionDetails(shareId)
      if (result.success && result.connectionDetails) {
        setConnectionDetails(result.connectionDetails)
      } else {
        setError(result.error || 'Failed to load connection details')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )
    }

    if (error) {
      return (
        <Alert variant="destructive" className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )
    }

    if (!connectionDetails) {
      return (
        <Alert className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Not Found</AlertTitle>
          <AlertDescription>Connection details not available.</AlertDescription>
        </Alert>
      )
    }

    // Handle different share statuses
    if (connectionDetails.shareStatus === 'pending') {
      return (
        <Alert className="m-4">
          <Clock className="h-4 w-4" />
          <AlertTitle>Access Pending</AlertTitle>
          <AlertDescription>
            Your request to access this topic is awaiting approval.
            You'll be able to connect once the owner approves.
          </AlertDescription>
        </Alert>
      )
    }

    if (connectionDetails.shareStatus === 'rejected') {
      return (
        <Alert variant="destructive" className="m-4">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Access Rejected</AlertTitle>
          <AlertDescription>
            Your request to access this topic was rejected.
            Contact the topic owner for more information.
          </AlertDescription>
        </Alert>
      )
    }

    if (connectionDetails.shareStatus === 'revoked') {
      return (
        <Alert variant="destructive" className="m-4">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Access Revoked</AlertTitle>
          <AlertDescription>
            Your access to this topic has been revoked.
            Contact the topic owner to request access again.
          </AlertDescription>
        </Alert>
      )
    }

    const serviceAccounts: ServiceAccountInfo[] = connectionDetails.serviceAccounts.map(sa => ({
      id: sa.id,
      name: sa.name,
      username: sa.username,
      status: sa.status,
    }))

    return (
      <div className="space-y-6 p-4">
        {/* Connection Info */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Bootstrap Servers</Label>
            <div className="flex gap-2">
              <Input
                value={connectionDetails.bootstrapServers}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(connectionDetails.bootstrapServers, 'bootstrap')}
              >
                {copiedField === 'bootstrap' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Topic Name</Label>
            <div className="flex gap-2">
              <Input
                value={connectionDetails.topicName}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(connectionDetails.topicName, 'topic')}
              >
                {copiedField === 'topic' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Auth Method</Label>
              <Badge variant="outline">{connectionDetails.authMethod}</Badge>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">TLS</Label>
              <Badge variant={connectionDetails.tlsEnabled ? 'default' : 'secondary'}>
                {connectionDetails.tlsEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Service Accounts */}
        <ServiceAccountSelector
          serviceAccounts={serviceAccounts}
          applicationId={connectionDetails.applicationId}
          workspaceSlug={workspaceSlug}
        />

        {/* Divider */}
        <div className="border-t" />

        {/* Code Snippets Button */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setCodeSnippetsOpen(true)}
        >
          <Code className="h-4 w-4 mr-2" />
          View Code Snippets
        </Button>

        {/* Code Snippets Dialog */}
        {serviceAccounts.length > 0 && (
          <CodeSnippetsDialog
            open={codeSnippetsOpen}
            onOpenChange={setCodeSnippetsOpen}
            connectionDetails={{
              bootstrapServers: connectionDetails.bootstrapServers,
              topicName: connectionDetails.topicName,
              username: serviceAccounts[0].username,
              authMethod: connectionDetails.authMethod,
              tlsEnabled: connectionDetails.tlsEnabled,
            }}
          />
        )}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Connection Details</SheetTitle>
          <SheetDescription>
            Use these details to connect to the shared topic
          </SheetDescription>
        </SheetHeader>
        {renderContent()}
      </SheetContent>
    </Sheet>
  )
}
```

**Step 2: Add export to kafka components index**

Check if `orbit-www/src/components/features/kafka/index.ts` exists and add exports. If not, we'll export from the component files directly.

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/kafka/ConnectionDetailsPanel.tsx
git commit -m "feat(kafka): add ConnectionDetailsPanel component with Sheet UI"
```

---

## Task 8: Integrate into TopicCatalog Component

**Files:**
- Modify: `orbit-www/src/components/features/kafka/TopicCatalog.tsx`

**Step 1: Add imports at top of file**

Add after existing imports (around line 14):

```typescript
import { Link2 } from 'lucide-react'
import { ConnectionDetailsPanel } from './ConnectionDetailsPanel'
```

**Step 2: Add state for connection details panel**

Add after existing dialog state (around line 70):

```typescript
// Connection details panel state
const [connectionPanelOpen, setConnectionPanelOpen] = useState(false)
const [selectedShareId, setSelectedShareId] = useState<string | null>(null)
```

**Step 3: Add handler to open connection details**

Add after `handleRequestAccess` function:

```typescript
const handleViewConnectionDetails = (topic: TopicCatalogEntry, shareId: string) => {
  setSelectedShareId(shareId)
  setConnectionPanelOpen(true)
}
```

**Step 4: Update searchTopicCatalog to return shareId**

We need to update the server action to also return the share ID. First, modify the `TopicCatalogEntry` type in `kafka-topic-catalog.ts`:

```typescript
export type TopicCatalogEntry = {
  // ... existing fields
  shareId?: string  // Add this
}
```

And in the `searchTopicCatalog` function, when building `shareStatusMap`, store the share ID:

```typescript
const shareStatusMap = new Map<string, { hasActive: boolean; status: string; shareId: string }>()
for (const share of existingShares.docs) {
  const topicId = typeof share.topic === 'string' ? share.topic : share.topic.id

  // Prioritize approved > pending > other statuses
  const existing = shareStatusMap.get(topicId)
  if (!existing || share.status === 'approved' ||
      (share.status === 'pending' && existing.status !== 'approved')) {
    shareStatusMap.set(topicId, {
      hasActive: share.status === 'approved',
      status: share.status,
      shareId: share.id,
    })
  }
}
```

And when returning topics, include shareId:

```typescript
shareId: shareInfo?.shareId,
```

**Step 5: Update the Actions column in the table**

Replace the existing Actions TableCell (around line 241-262) with:

```typescript
<TableCell className="text-right">
  {isOwnWorkspace ? (
    <Button variant="ghost" size="sm" asChild>
      <a href={`/${topic.workspace.slug}/kafka/applications`}>
        <ExternalLink className="h-4 w-4 mr-1" />
        View
      </a>
    </Button>
  ) : topic.shareStatus === 'approved' && topic.shareId ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => handleViewConnectionDetails(topic, topic.shareId!)}
    >
      <Link2 className="h-4 w-4 mr-1" />
      Connect
    </Button>
  ) : topic.hasActiveShare ? (
    <span className="text-sm text-muted-foreground">
      Requested
    </span>
  ) : (
    <Button
      variant="outline"
      size="sm"
      onClick={() => handleRequestAccess(topic)}
    >
      Request Access
    </Button>
  )}
</TableCell>
```

**Step 6: Add ConnectionDetailsPanel at end of component**

Add before the closing Card tag (before `</CardContent>`):

```typescript
{/* Connection Details Panel */}
{selectedShareId && (
  <ConnectionDetailsPanel
    open={connectionPanelOpen}
    onOpenChange={setConnectionPanelOpen}
    shareId={selectedShareId}
    workspaceSlug={currentWorkspaceId} // We need to pass workspaceSlug - update props
  />
)}
```

**Step 7: Update TopicCatalogProps to include workspaceSlug**

Update the interface:

```typescript
interface TopicCatalogProps {
  currentWorkspaceId: string
  currentWorkspaceName: string
  currentWorkspaceSlug: string  // Add this
}
```

And destructure it in the component.

**Step 8: Update catalog page to pass workspaceSlug**

In `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/catalog/page.tsx`, update the TopicCatalog props:

```typescript
<TopicCatalog
  currentWorkspaceId={workspace.id}
  currentWorkspaceName={workspace.name}
  currentWorkspaceSlug={workspace.slug}
/>
```

**Step 9: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add orbit-www/src/components/features/kafka/TopicCatalog.tsx orbit-www/src/app/actions/kafka-topic-catalog.ts orbit-www/src/app/\\(frontend\\)/workspaces/\\[slug\\]/kafka/catalog/page.tsx
git commit -m "feat(kafka): integrate ConnectionDetailsPanel into TopicCatalog"
```

---

## Task 9: Integrate into SharedTopicsList Component

**Files:**
- Modify: `orbit-www/src/components/features/kafka/SharedTopicsList.tsx`

**Step 1: Add imports**

Add after existing imports:

```typescript
import { Link2 } from 'lucide-react'
import { ConnectionDetailsPanel } from './ConnectionDetailsPanel'
```

**Step 2: Update props to include workspaceSlug**

Update the interface:

```typescript
interface SharedTopicsListProps {
  workspaceId: string
  workspaceSlug: string  // Add this
  type: 'incoming' | 'outgoing'
  canManage: boolean
}
```

**Step 3: Add state for connection panel**

Add after existing dialog states (around line 43):

```typescript
const [connectionPanelOpen, setConnectionPanelOpen] = useState(false)
const [selectedShareForConnection, setSelectedShareForConnection] = useState<ShareListItem | null>(null)
```

**Step 4: Add handler**

Add after `openRevokeDialog`:

```typescript
const handleViewConnectionDetails = (share: ShareListItem) => {
  setSelectedShareForConnection(share)
  setConnectionPanelOpen(true)
}
```

**Step 5: Update Actions column for approved shares**

In the table row rendering, update the Actions cell for approved shares. Find the section that shows the revoke button for approved shares and add the connection details button:

Replace:
```typescript
{share.status === 'approved' && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => openRevokeDialog(share)}
  >
    <Trash2 className="h-4 w-4" />
  </Button>
)}
```

With:
```typescript
{share.status === 'approved' && (
  <div className="flex gap-1 justify-end">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleViewConnectionDetails(share)}
      title="View connection details"
    >
      <Link2 className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => openRevokeDialog(share)}
      title="Revoke access"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
)}
```

**Step 6: Also add for outgoing shares (consumer view)**

For outgoing shares (type === 'outgoing'), also show the connection details button when status is approved. Add a new column or update the existing actions:

After the existing Actions column for incoming, add an Actions column for outgoing:

```typescript
{type === 'outgoing' && share.status === 'approved' && (
  <TableCell className="text-right">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleViewConnectionDetails(share)}
      title="View connection details"
    >
      <Link2 className="h-4 w-4" />
    </Button>
  </TableCell>
)}
```

**Step 7: Add ConnectionDetailsPanel at end of component**

Add before the closing fragment (`</>`):

```typescript
{/* Connection Details Panel */}
{selectedShareForConnection && (
  <ConnectionDetailsPanel
    open={connectionPanelOpen}
    onOpenChange={setConnectionPanelOpen}
    shareId={selectedShareForConnection.id}
    workspaceSlug={workspaceSlug}
  />
)}
```

**Step 8: Verify TypeScript compiles**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: No errors

**Step 9: Update usages of SharedTopicsList to pass workspaceSlug**

Search for usages and add the workspaceSlug prop.

**Step 10: Commit**

```bash
git add orbit-www/src/components/features/kafka/SharedTopicsList.tsx
git commit -m "feat(kafka): integrate ConnectionDetailsPanel into SharedTopicsList"
```

---

## Task 10: Final Testing and Cleanup

**Step 1: Run all tests**

```bash
cd orbit-www && pnpm test
```

**Step 2: Run TypeScript check**

```bash
cd orbit-www && pnpm exec tsc --noEmit
```

**Step 3: Run linter**

```bash
cd orbit-www && pnpm lint
```

**Step 4: Fix any issues found**

**Step 5: Manual testing checklist**

- [ ] Create a BifrostConfig entry via admin UI
- [ ] Navigate to Topic Catalog with an approved share
- [ ] Click "Connect" button on approved topic
- [ ] Verify ConnectionDetailsPanel opens with correct data
- [ ] Verify bootstrap servers and topic name display correctly
- [ ] Verify service accounts are listed (or warning if none)
- [ ] Click "View Code Snippets" and verify all 4 languages render
- [ ] Test copy buttons work
- [ ] Navigate to SharedTopicsList
- [ ] Click connection details on approved share
- [ ] Verify panel works in this context too

**Step 6: Final commit**

```bash
git add -A
git commit -m "test(kafka): manual testing verified for connection details feature"
```

---

## Summary

This plan implements the Consumer Connection Information feature in 10 tasks:

1. **BifrostConfig Collection** - Admin-configurable connection settings
2. **getBifrostConfig Helper** - Fetch config with defaults
3. **getConnectionDetails Server Action** - Main API for connection info
4. **Code Snippet Templates** - Java, Python, Node.js, Go templates
5. **ServiceAccountSelector Component** - Credential selection UI
6. **CodeSnippetsDialog Component** - Language-tabbed code modal
7. **ConnectionDetailsPanel Component** - Main Sheet panel
8. **TopicCatalog Integration** - "Connect" button for approved shares
9. **SharedTopicsList Integration** - Connection details for shared topics
10. **Final Testing** - Verify all functionality works
