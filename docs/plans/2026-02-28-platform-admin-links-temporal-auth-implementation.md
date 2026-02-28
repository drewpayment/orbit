# Platform Admin Links & Temporal Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add external console links to Kafka clusters, a Temporal UI link in platform admin nav, Better Auth as an OIDC provider, and oauth2-proxy to protect Temporal UI in production.

**Architecture:** Four independent features stacked in dependency order. Features 1-2 are UI-only changes. Feature 3 adds OIDC provider capability to Better Auth using the `@better-auth/oauth-provider` package. Feature 4 deploys oauth2-proxy in K8s pointed at the OIDC provider.

**Tech Stack:** Next.js 15 / React 19 / Payload 3.0 / Better Auth / @better-auth/oauth-provider / oauth2-proxy / Kubernetes Gateway API

---

## Task 1: Add `consoleUrl` Field to KafkaClusters Collection

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaClusters.ts:18-84`

**Step 1: Add the `consoleUrl` field to the collection**

Add after the `description` field (line 83):

```typescript
{
  name: 'consoleUrl',
  type: 'text',
  admin: {
    description: 'URL to the cluster management console (e.g., Redpanda Console)',
  },
},
```

**Step 2: Verify the Payload config loads without errors**

Run: `cd orbit-www && bun run build 2>&1 | head -20`
Expected: No TypeScript errors related to KafkaClusters

**Step 3: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaClusters.ts
git commit -m "feat: add consoleUrl field to KafkaClusters collection"
```

---

## Task 2: Add `consoleUrl` to Server Action Types and Mapping

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-admin.ts`

**Step 1: Add `consoleUrl` to `KafkaClusterConfig` interface**

At `kafka-admin.ts:237` (after `schemaRegistryUrl?: string`), add:

```typescript
consoleUrl?: string
```

**Step 2: Add `consoleUrl` to `PayloadKafkaCluster` interface**

At `kafka-admin.ts:527` (after `description?: string`), add:

```typescript
consoleUrl?: string
```

**Step 3: Map `consoleUrl` in `mapPayloadClusterToConfig`**

At `kafka-admin.ts:549` (after the `config` line in the return object), add:

```typescript
consoleUrl: cluster.consoleUrl,
```

**Step 4: Add `consoleUrl` to `validateClusterInput`**

At `kafka-admin.ts:156` (after the `schemaRegistryUrl` validation block), add:

```typescript
if (data.consoleUrl && !isValidUrl(data.consoleUrl)) {
  errors.push({
    field: 'consoleUrl',
    message: 'Console URL must be a valid HTTP or HTTPS URL',
  })
}
```

Also update the `validateClusterInput` function parameter type at line 120 to include:
```typescript
consoleUrl?: string
```

**Step 5: Include `consoleUrl` in `createCluster` action**

At `kafka-admin.ts:705` (inside the `data` object passed to `payload.create`), add:

```typescript
consoleUrl: data.consoleUrl || undefined,
```

Also update the `CreateClusterInput` interface (around line 660) to include:
```typescript
consoleUrl?: string
```

**Step 6: Include `consoleUrl` in `updateCluster` action**

At `kafka-admin.ts:845` (before the `// Perform the update` comment), add:

```typescript
if (data.consoleUrl !== undefined) {
  updateData.consoleUrl = data.consoleUrl || undefined
}
```

Also update the update function's data parameter type (around line 765) to include:
```typescript
consoleUrl?: string
```

**Step 7: Verify TypeScript compiles**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 8: Commit**

```bash
git add orbit-www/src/app/actions/kafka-admin.ts
git commit -m "feat: add consoleUrl to Kafka cluster types and server actions"
```

---

## Task 3: Add "Open Console" Button to ClustersTab

**Files:**
- Modify: `orbit-www/src/app/(frontend)/platform/kafka/components/ClustersTab.tsx`

**Step 1: Add `ExternalLink` to lucide-react imports**

At `ClustersTab.tsx:7`, add `ExternalLink` to the import:

```typescript
import { Plus, RefreshCw, Server, Database, Globe, Link2, ExternalLink } from 'lucide-react'
```

**Step 2: Add the console link button to the cluster card header**

Replace the `CardHeader` block (lines 150-166) with:

```tsx
<CardHeader className="pb-3">
  <div className="flex items-start justify-between">
    <div className="flex items-center gap-2">
      <Database className="h-5 w-5 text-muted-foreground" />
      <CardTitle className="text-base">{cluster.name}</CardTitle>
    </div>
    <div className="flex items-center gap-2">
      {cluster.consoleUrl && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation()
            window.open(cluster.consoleUrl, '_blank', 'noopener,noreferrer')
          }}
          title="Open cluster console"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
      <Badge
        variant={statusBadge.variant}
        className={statusBadge.className}
      >
        {statusBadge.label}
      </Badge>
    </div>
  </div>
  <CardDescription className="text-xs">
    {providerName}
  </CardDescription>
</CardHeader>
```

**Step 3: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/ClustersTab.tsx
git commit -m "feat: add Open Console button to Kafka cluster cards"
```

---

## Task 4: Add `consoleUrl` Input to ClusterDetail Form

**Files:**
- Modify: `orbit-www/src/app/(frontend)/platform/kafka/components/ClusterDetail.tsx`

**Step 1: Add `consoleUrl` state**

At `ClusterDetail.tsx:105` (after the `schemaRegistryUrl` state), add:

```typescript
const [consoleUrl, setConsoleUrl] = useState(cluster?.consoleUrl || '')
```

**Step 2: Include `consoleUrl` in `handleSave`**

At `ClusterDetail.tsx:123` (in the `onSave` call object, after `schemaRegistryUrl`), add:

```typescript
consoleUrl: consoleUrl || undefined,
```

**Step 3: Add the input field to the form**

After the Schema Registry URL field block (after line 285), add:

```tsx
{/* Console URL */}
<div className="space-y-2">
  <Label htmlFor="consoleUrl">Console URL (Optional)</Label>
  <Input
    id="consoleUrl"
    value={consoleUrl}
    onChange={(e) => setConsoleUrl(e.target.value)}
    placeholder="http://localhost:8083"
  />
  <p className="text-xs text-muted-foreground">
    URL to the cluster management console (e.g., Redpanda Console)
  </p>
</div>
```

**Step 4: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/ClusterDetail.tsx
git commit -m "feat: add consoleUrl input to cluster detail form"
```

---

## Task 5: Add "Workflows" to Platform Admin Sidebar

**Files:**
- Modify: `orbit-www/src/components/app-sidebar.tsx`

**Step 1: Add `Workflow` icon import**

At `app-sidebar.tsx:4`, add `Workflow` to the lucide-react import:

```typescript
import {
  BookOpen,
  Building2,
  Command,
  FileCode,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  MessageSquare,
  RadioTower,
  Shield,
  Workflow,
} from "lucide-react"
```

**Step 2: Add "Workflows" entry to `navPlatformData`**

At `app-sidebar.tsx:97` (after the Kafka entry's closing `}`), add:

```typescript
{
  title: "Workflows",
  url: "/platform/workflows",
  icon: Workflow,
},
```

**Step 3: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/components/app-sidebar.tsx
git commit -m "feat: add Workflows entry to platform admin sidebar"
```

---

## Task 6: Create Platform Workflows Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/workflows/page.tsx`

**Step 1: Create the page**

```tsx
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ExternalLink, Workflow } from 'lucide-react'

export const metadata = {
  title: 'Workflows - Orbit Admin',
  description: 'Manage Temporal workflows and background operations',
}

const TEMPORAL_UI_URL = process.env.NEXT_PUBLIC_TEMPORAL_UI_URL || 'http://localhost:8080'

export default function WorkflowsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-muted-foreground">
              Monitor and manage background workflows powered by Temporal.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Workflow className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Temporal UI</CardTitle>
                </div>
                <CardDescription>
                  View workflow executions, search history, and debug running workflows
                  in the Temporal Web UI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <a
                    href={TEMPORAL_UI_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Temporal UI
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 2: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/workflows/page.tsx
git commit -m "feat: add platform workflows page with Temporal UI link"
```

---

## Task 7: Add `NEXT_PUBLIC_TEMPORAL_UI_URL` to K8s ConfigMap

**Files:**
- Modify: `infrastructure/k8s/orbit-www/configmap.yaml`

**Step 1: Add the env var**

At the end of the `data` section in `configmap.yaml`, add:

```yaml
NEXT_PUBLIC_TEMPORAL_UI_URL: "https://temporal.orbit.hoytlabs.app"
```

**Step 2: Commit**

```bash
git add infrastructure/k8s/orbit-www/configmap.yaml
git commit -m "feat: add NEXT_PUBLIC_TEMPORAL_UI_URL to K8s configmap"
```

---

## Task 8: Install `@better-auth/oauth-provider` Package

**Files:**
- Modify: `orbit-www/package.json`

**Note:** We use the newer `@better-auth/oauth-provider` package instead of the deprecated `oidcProvider` from `better-auth/plugins`. This provides OAuth 2.1 compliance, PKCE, separate claim hooks for ID tokens/access tokens/userinfo, and token introspection.

**Step 1: Install the package**

Run: `cd orbit-www && pnpm add @better-auth/oauth-provider`

**Step 2: Verify installation**

Run: `cd orbit-www && pnpm list @better-auth/oauth-provider`
Expected: Shows the installed version

**Step 3: Commit**

```bash
git add orbit-www/package.json orbit-www/pnpm-lock.yaml
git commit -m "feat: install @better-auth/oauth-provider package"
```

---

## Task 9: Configure Better Auth as OIDC Provider

**Files:**
- Modify: `orbit-www/src/lib/auth.ts`

**Step 1: Add imports**

At the top of `auth.ts`, add:

```typescript
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
```

**Step 2: Add `plugins` array and `disabledPaths` to the `betterAuth` config**

Add `disabledPaths` at the top level of the `betterAuth()` config (e.g., after `baseURL`):

```typescript
disabledPaths: ["/token"],
```

Add a `plugins` array at the top level:

```typescript
plugins: [
  jwt(),
  oauthProvider({
    loginPage: "/sign-in",
    consentPage: "/sign-in",
    accessTokenExpiresIn: "1h",
    idTokenExpiresIn: "10h",
    refreshTokenExpiresIn: "30d",
    scopes: ["openid", "profile", "email"],
    customIdTokenClaims: ({ user }) => ({
      role: (user as Record<string, unknown>).role || "user",
    }),
    customUserInfoClaims: ({ user }) => ({
      role: (user as Record<string, unknown>).role || "user",
    }),
  }),
],
```

**Step 3: Register the oauth2-proxy OIDC client as a trusted client**

The `@better-auth/oauth-provider` supports dynamic client registration. For oauth2-proxy, we'll register it programmatically on startup or via a seed script. For now, enable dynamic registration:

In the `oauthProvider()` config, add:

```typescript
allowDynamicClientRegistration: true,
```

**Step 4: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 5: Run database migration**

The OAuth provider plugin creates tables for `oauthApplication`, `oauthAccessToken`, and `oauthConsent`.

Run: `cd orbit-www && npx @better-auth/cli migrate`

If that command is not available, Better Auth may auto-create the MongoDB collections on first use (since MongoDB is schemaless).

**Step 6: Commit**

```bash
git add orbit-www/src/lib/auth.ts
git commit -m "feat: configure Better Auth as OIDC provider with oauth-provider plugin"
```

---

## Task 10: Add OIDC Discovery Route Handler

**Files:**
- Create: `orbit-www/src/app/.well-known/openid-configuration/route.ts`

**Note:** The `@better-auth/oauth-provider` requires an explicit Next.js route handler for the discovery endpoint.

**Step 1: Create the route handler**

```typescript
import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"
import { auth } from "@/lib/auth"

export const GET = oauthProviderOpenIdConfigMetadata(auth)
```

**Step 2: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/.well-known/openid-configuration/route.ts
git commit -m "feat: add OIDC discovery endpoint route handler"
```

---

## Task 11: Update Auth Client with OAuth Provider Plugin

**Files:**
- Modify: `orbit-www/src/lib/auth-client.ts`

**Step 1: Read the current auth-client.ts to understand existing config**

Read: `orbit-www/src/lib/auth-client.ts`

**Step 2: Add the client-side plugin import and configuration**

Add to imports:

```typescript
import { oauthProviderClient } from "@better-auth/oauth-provider/client"
```

Add `oauthProviderClient()` to the `plugins` array in `createAuthClient()`. If there's no `plugins` array, add one:

```typescript
plugins: [oauthProviderClient()],
```

**Step 3: Verify it builds**

Run: `cd orbit-www && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add orbit-www/src/lib/auth-client.ts
git commit -m "feat: add oauth-provider client plugin to auth client"
```

---

## Task 12: Add oauth2-proxy Secrets to ExternalSecret

**Files:**
- Modify: `infrastructure/k8s/externalsecret.yaml`

**Step 1: Add oauth2-proxy secrets**

At the end of the `data` array in `externalsecret.yaml`, add:

```yaml
# OAuth2 Proxy (Temporal UI auth)
- secretKey: OAUTH2_PROXY_CLIENT_ID
  remoteRef: { key: ORBIT_OAUTH2_PROXY_CLIENT_ID }
- secretKey: OAUTH2_PROXY_CLIENT_SECRET
  remoteRef: { key: ORBIT_OAUTH2_PROXY_CLIENT_SECRET }
- secretKey: OAUTH2_PROXY_COOKIE_SECRET
  remoteRef: { key: ORBIT_OAUTH2_PROXY_COOKIE_SECRET }
```

**Step 2: Commit**

```bash
git add infrastructure/k8s/externalsecret.yaml
git commit -m "feat: add oauth2-proxy secrets to ExternalSecret"
```

---

## Task 13: Create oauth2-proxy K8s Deployment

**Files:**
- Create: `infrastructure/k8s/oauth2-proxy/deployment.yaml`
- Create: `infrastructure/k8s/oauth2-proxy/service.yaml`
- Create: `infrastructure/k8s/oauth2-proxy/kustomization.yaml`

**Step 1: Create the deployment manifest**

Create `infrastructure/k8s/oauth2-proxy/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
  namespace: orbit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: oauth2-proxy
  template:
    metadata:
      labels:
        app: oauth2-proxy
    spec:
      serviceAccountName: orbit
      containers:
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy:v7.14.3
          ports:
            - containerPort: 4180
              name: http
              protocol: TCP
          args:
            - --provider=oidc
            - --oidc-issuer-url=https://orbit.hoytlabs.app
            - --redirect-url=https://temporal.orbit.hoytlabs.app/oauth2/callback
            - --upstream=http://temporal-ui:8080
            - --http-address=0.0.0.0:4180
            - --reverse-proxy=true
            - --skip-provider-button=true
            - --email-domain=*
            - --cookie-domain=.hoytlabs.app
            - --cookie-secure=true
            - --cookie-samesite=lax
            - --cookie-expire=24h
            - --cookie-refresh=1h
            - --oidc-groups-claim=role
            - --allowed-group=super_admin
            - --allowed-group=admin
            - --pass-authorization-header=true
            - --set-xauthrequest=true
            - --scope=openid profile email
          env:
            - name: OAUTH2_PROXY_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: OAUTH2_PROXY_CLIENT_ID
            - name: OAUTH2_PROXY_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: OAUTH2_PROXY_CLIENT_SECRET
            - name: OAUTH2_PROXY_COOKIE_SECRET
              valueFrom:
                secretKeyRef:
                  name: orbit-secrets
                  key: OAUTH2_PROXY_COOKIE_SECRET
          livenessProbe:
            httpGet:
              path: /ping
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
```

**Step 2: Create the service manifest**

Create `infrastructure/k8s/oauth2-proxy/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: oauth2-proxy
  namespace: orbit
spec:
  selector:
    app: oauth2-proxy
  ports:
    - port: 4180
      targetPort: http
      protocol: TCP
      name: http
```

**Step 3: Create the kustomization**

Create `infrastructure/k8s/oauth2-proxy/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

**Step 4: Commit**

```bash
git add infrastructure/k8s/oauth2-proxy/
git commit -m "feat: add oauth2-proxy K8s deployment for Temporal UI auth"
```

---

## Task 14: Route Temporal UI HTTPRoute Through oauth2-proxy

**Files:**
- Modify: `infrastructure/k8s/temporal/ui-http-route.yaml`

**Step 1: Update the backend ref**

Change the `backendRefs` in `ui-http-route.yaml` from:

```yaml
backendRefs:
  - name: temporal-ui
    port: 8080
```

to:

```yaml
backendRefs:
  - name: oauth2-proxy
    port: 4180
```

**Step 2: Commit**

```bash
git add infrastructure/k8s/temporal/ui-http-route.yaml
git commit -m "feat: route Temporal UI traffic through oauth2-proxy"
```

---

## Task 15: Add oauth2-proxy to Root Kustomization

**Files:**
- Modify: `infrastructure/k8s/kustomization.yaml`

**Step 1: Add oauth2-proxy to the resources list**

After the `temporal` entry under `# Infrastructure`, add:

```yaml
- oauth2-proxy
```

**Step 2: Verify kustomize builds**

Run: `kubectl kustomize infrastructure/k8s/ 2>&1 | head -5`
Expected: Valid YAML output, no errors

**Step 3: Commit**

```bash
git add infrastructure/k8s/kustomization.yaml
git commit -m "feat: add oauth2-proxy to root kustomization"
```

---

## Task 16: Final Verification

**Step 1: Verify frontend builds cleanly**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds

**Step 2: Verify kustomize renders all manifests**

Run: `kubectl kustomize infrastructure/k8s/ > /dev/null && echo "OK"`
Expected: OK

**Step 3: Verify lint passes**

Run: `cd orbit-www && pnpm lint`
Expected: No errors

**Step 4: Create final commit if any remaining changes**

```bash
git status
# If clean, no commit needed
```
