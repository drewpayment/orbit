# SOP: GitHub App Installation Pattern (Organization-Level)

**Created**: 2025-11-13
**Last Updated**: 2025-11-13
**Trigger**: When implementing organization-level GitHub integration or similar enterprise app installations

## Purpose

This SOP establishes the **enterprise app installation pattern** for GitHub and similar organization-level integrations (Confluence, Jira, etc.). This pattern differs from user-level OAuth (see `.agent/SOPs/user-oauth-integrations.md`).

## Pattern Overview

**Enterprise App Installation** (this SOP):
- Orbit admin installs app into their GitHub organization
- App generates **installation tokens** (not user tokens)
- All users in workspace share the same installation
- Operations execute as "App Bot" (e.g., "Orbit IDP Bot")
- Admin controls which workspaces can use each org

**User OAuth** (different SOP):
- Individual users authorize personal access
- Each user has their own token
- Operations execute as the user
- Use for: Notion personal workspace, Google Drive, etc.

---

## Core Principles

### 1. Organization-Level Installation

```
Orbit Admin → Installs GitHub App → GitHub Organization
                      ↓
              Installation Token (bot)
                      ↓
          Admin maps: Workspace → GitHub Org
                      ↓
          All workspace users share installation
```

### 2. Bot Identity

All operations execute as the bot:
- **Author**: "Orbit IDP <bot@orbit.dev>"
- **Commit Message**: "Initial commit\n\nRequested by: @username"
- No individual user GitHub permission checks

### 3. Multi-Tenancy Ready

Design for multi-tenant SaaS from day one:
- Add optional `tenant` field to all integration collections
- Self-hosted: tenant = null (single default tenant)
- SaaS: Multiple tenants with full isolation

### 4. Token Lifecycle Management

- Installation tokens expire after 1 hour
- Temporal workflow refreshes every 50 minutes
- Workflow runs continuously until app uninstalled
- Webhooks notify of app uninstall/suspend events

---

## When to Use This Pattern

**Use Enterprise App Installation for:**
- ✅ GitHub (repos created in org, shared across workspace)
- ✅ Confluence (workspace-wide documentation sync)
- ✅ Jira (workspace-wide project integration)
- ✅ GitLab (organization-level)
- ✅ Slack workspace app installations

**Do NOT use this pattern for:**
- ❌ Notion personal workspace (use user OAuth)
- ❌ Google Drive personal files (use user OAuth)
- ❌ User-specific Slack DMs (use user OAuth)

See `.agent/SOPs/user-oauth-integrations.md` for user-level patterns.

---

## Implementation Architecture

### MongoDB Schema (Payload Collection)

```typescript
// Collection: github-installations (or <service>-installations)
{
  // Installation Identity
  installationId: number,        // External service installation ID
  accountLogin: string,           // Organization name
  accountId: number,
  accountType: 'Organization' | 'User',

  // Access Token (Encrypted!)
  installationToken: string,      // MUST be encrypted
  tokenExpiresAt: Date,
  tokenLastRefreshedAt: Date,

  // Access Configuration
  repositorySelection: 'all' | 'selected',
  selectedRepositories: [
    { fullName: string, id: number, private: boolean }
  ],

  // Workspace Mapping
  allowedWorkspaces: Workspace[], // Which workspaces can use this

  // Lifecycle Status
  status: 'active' | 'suspended' | 'refresh_failed',
  suspendedAt: Date,
  suspensionReason: string,

  // Temporal Integration
  temporalWorkflowId: string,     // Token refresh workflow
  temporalWorkflowStatus: 'running' | 'stopped' | 'failed',

  // Metadata
  installedBy: User,
  installedAt: Date,

  // Multi-Tenancy (Future)
  tenant: Tenant,                 // null = default tenant
}
```

### Temporal Token Refresh Workflow

```go
// Long-running workflow that never terminates until app uninstalled
func GitHubTokenRefreshWorkflow(ctx workflow.Context, input GitHubTokenRefreshWorkflowInput) error {
    for {
        // Refresh token (activity)
        workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID)

        // Sleep 50 minutes (10 min before expiry)
        workflow.Sleep(ctx, 50 * time.Minute)
    }
}

// Activity: Fetch new token from GitHub, encrypt, store in Payload
func RefreshGitHubInstallationTokenActivity(ctx context.Context, installationID string) error {
    // 1. Fetch installation from Payload
    // 2. Generate new token from GitHub API
    // 3. Encrypt token
    // 4. Update Payload document
    // 5. Update status to 'active'
}
```

### Installation Flow

```
1. Admin clicks "Install GitHub App" in Orbit admin UI
   ↓
2. Redirect to GitHub App installation page
   https://github.com/apps/orbit-idp/installations/new?state=<csrf>
   ↓
3. Admin selects repos and authorizes
   ↓
4. GitHub redirects to callback:
   /api/github/installation/callback?installation_id=123&setup_action=install
   ↓
5. Backend:
   - Fetch installation details from GitHub API
   - Generate installation access token
   - Encrypt token
   - Store in 'github-installations' collection
   - Start Temporal token refresh workflow
   ↓
6. Redirect admin to workspace configuration page:
   /admin/settings/github/{id}/configure
   ↓
7. Admin selects which workspaces can use this GitHub org
   ↓
8. Done! Workflows can now use installation token
```

### Using Installation in Workflows

```go
func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
    // Find GitHub installation for this workspace
    installation, err := a.findGitHubInstallationForWorkspace(ctx, input.WorkspaceID)
    if err != nil {
        return fmt.Errorf("no GitHub installation configured for workspace")
    }

    // Decrypt token
    token, err := a.encryption.Decrypt(installation.InstallationToken)

    // Use token for Git operations
    cmd := exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
    cmd.Env = append(os.Environ(),
        fmt.Sprintf("GIT_ASKPASS=%s", credentialHelper(token)),
    )

    return cmd.Run()
}

func (a *GitActivities) findGitHubInstallationForWorkspace(ctx context.Context, workspaceID string) (*Installation, error) {
    // Query Payload: github-installations where allowedWorkspaces contains workspaceID
    installations, err := a.payloadClient.FindDocuments(ctx, "github-installations", map[string]interface{}{
        "allowedWorkspaces": map[string]interface{}{
            "contains": workspaceID,
        },
        "status": "active",
    })

    if len(installations) == 0 {
        return nil, errors.New("no active installation found")
    }

    return installations[0], nil
}
```

### Webhook Handling

```typescript
// /api/github/webhooks
export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hub-signature-256')
  const payload = await request.text()

  // Verify webhook signature
  if (!verifyWebhookSignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(payload)

  switch (event.action) {
    case 'deleted': {
      // GitHub App uninstalled
      await handleAppUninstalled(event.installation.id)
      break
    }
    case 'suspend': {
      // GitHub App suspended
      await handleAppSuspended(event.installation.id)
      break
    }
  }

  return NextResponse.json({ status: 'ok' })
}

async function handleAppUninstalled(githubInstallationId: number) {
  // Find installation in Payload
  const installation = await payload.find({
    collection: 'github-installations',
    where: { installationId: { equals: githubInstallationId } },
  })

  // Cancel Temporal workflow
  await cancelGitHubTokenRefreshWorkflow(installation.temporalWorkflowId)

  // Update status
  await payload.update({
    collection: 'github-installations',
    id: installation.id,
    data: {
      status: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: 'GitHub App uninstalled by user',
      temporalWorkflowStatus: 'stopped',
    },
  })
}
```

---

## Security Requirements

### 1. Token Encryption

**MANDATORY**: All installation tokens MUST be encrypted at rest.

```typescript
// AES-256-GCM encryption
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY! // 32-byte base64

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

**Production**: Use KMS (AWS Secrets Manager, HashiCorp Vault) instead of env var key.

### 2. Webhook Signature Verification

**MANDATORY**: Always verify webhook signatures.

```typescript
import crypto from 'crypto'

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  const digest = 'sha256=' + hmac.update(payload).digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  )
}
```

### 3. CSRF Protection

**MANDATORY**: Use state parameter for installation flow.

```typescript
// Initiate installation
const state = crypto.randomUUID()
sessionStorage.setItem('github_install_state', state)
window.location.href = `https://github.com/apps/orbit-idp/installations/new?state=${state}`

// Verify in callback
const savedState = sessionStorage.getItem('github_install_state')
if (state !== savedState) throw new Error('Invalid state')
```

### 4. Multi-Tenancy Isolation

**MANDATORY for SaaS**: Filter all queries by tenant.

```typescript
// Always include tenant filter
const installations = await payload.find({
  collection: 'github-installations',
  where: {
    tenant: { equals: currentTenant.id },
    allowedWorkspaces: { contains: workspaceID },
    status: 'active',
  },
})
```

---

## Admin UI Requirements

### Installation List Page

**Location**: `/admin/settings/github`

**Features:**
- List all GitHub installations
- Show status badges (active, suspended, refresh_failed)
- Display organization name and avatar
- Show number of allowed workspaces
- "Install GitHub App" button
- "Configure" button per installation

### Workspace Configuration Page

**Location**: `/admin/settings/github/{id}/configure`

**Features:**
- Display GitHub organization name
- Multi-select checkboxes for workspaces
- Save configuration
- Show which repos are accessible

### Workspace Settings View

**Location**: `/workspaces/{id}/settings/github`

**Features (Read-Only for non-admins):**
- Show available GitHub organizations
- Display status of each installation
- Warning if installation suspended
- Link to admin settings (if user is admin)

---

## Error Handling

### User-Friendly Errors

**When workspace has no GitHub installation:**

```typescript
throw new Error(
  'GitHub integration not configured for this workspace.\n\n' +
  'Please ask an admin to install the GitHub App and grant access to this workspace.\n\n' +
  'See: /admin/settings/github'
)
```

**When GitHub App uninstalled:**

```typescript
throw new Error(
  'GitHub App has been uninstalled.\n\n' +
  'Repository operations will fail until the GitHub App is reinstalled.\n\n' +
  'Contact your Orbit admin to reinstall the GitHub App.'
)
```

**When token refresh fails:**

```typescript
// Don't fail workflow - log and retry
logger.error('Token refresh failed', { error })

// Update installation status
await payload.update({
  collection: 'github-installations',
  id: installation.id,
  data: {
    status: 'refresh_failed',
    suspensionReason: error.message,
  },
})

// Continue trying (workflow keeps running)
```

---

## Testing Strategy

### Unit Tests

```typescript
// Mock Payload, GitHub API, encryption
describe('RefreshGitHubInstallationTokenActivity', () => {
  it('fetches new token and updates Payload', async () => {
    const mockPayload = new MockPayloadClient()
    const mockGitHub = new MockGitHubClient()
    const mockEncryption = new MockEncryptionService()

    const activity = new GitHubTokenActivities(mockPayload, mockGitHub, mockEncryption)

    const result = await activity.RefreshGitHubInstallationTokenActivity(ctx, 'install-123')

    expect(result.Success).toBe(true)
    expect(mockPayload.UpdateDocumentCalled).toBe(true)
  })
})
```

### Integration Tests

```bash
# Test with real GitHub App (use test organization)
GITHUB_APP_ID=<test_app_id> \
GITHUB_APP_PRIVATE_KEY_PATH=./test-app.pem \
go test -v -tags=integration ./internal/activities/
```

### E2E Tests

1. Install GitHub App in test organization
2. Configure workspace access
3. Trigger repository creation workflow
4. Verify token refresh workflow running
5. Uninstall GitHub App
6. Verify workflow cancelled and status updated

---

## Adapting for Other Services

This pattern applies to any organization-level integration:

### Confluence

```typescript
// Collection: confluence-installations
{
  siteUrl: string,              // e.g., "mycompany.atlassian.net"
  apiToken: string,              // Encrypted
  userEmail: string,             // For API auth
  allowedWorkspaces: Workspace[],
  status: 'active' | 'suspended',
  installedBy: User,
}

// No token refresh needed (API tokens don't expire)
// Workflow not required
```

### GitLab

```typescript
// Collection: gitlab-installations
{
  installationId: number,
  groupPath: string,             // e.g., "mycompany"
  accessToken: string,           // Encrypted
  tokenExpiresAt: Date,
  allowedWorkspaces: Workspace[],
  status: 'active' | 'suspended',
  temporalWorkflowId: string,    // If tokens expire
}

// Similar to GitHub pattern
// Token refresh if GitLab tokens expire
```

### Jira

```typescript
// Collection: jira-installations
{
  siteUrl: string,
  apiToken: string,              // Encrypted
  userEmail: string,
  projectKeys: string[],         // Which Jira projects accessible
  allowedWorkspaces: Workspace[],
  status: 'active' | 'suspended',
}

// No token refresh needed
```

---

## Checklist for New Installations

When implementing a new org-level integration:

- [ ] Create Payload collection (`<service>-installations`)
- [ ] Include `tenant` field for multi-tenancy
- [ ] Encrypt all access tokens/API keys
- [ ] Implement installation callback handler
- [ ] Build admin UI (list + configure workspaces)
- [ ] Build workspace settings view (read-only)
- [ ] Implement token refresh workflow (if tokens expire)
- [ ] Add webhook handlers (if service supports)
- [ ] Write unit tests with mocks
- [ ] Write integration tests with real service
- [ ] Document in this SOP (add to "Adapting for Other Services")
- [ ] Update activities to use installation tokens
- [ ] Add user-friendly errors for missing installations

---

## Migration Path

### From User OAuth to Enterprise App

If you previously implemented user OAuth (e.g., for GitHub) and need to migrate:

1. **Keep both patterns temporarily**:
   - User OAuth for existing users
   - Enterprise app for new installs

2. **Add migration flag**:
   ```typescript
   {
     useEnterpriseApp: boolean,  // true = use installation, false = use user OAuth
   }
   ```

3. **Update activities to check flag**:
   ```go
   if workspace.UseEnterpriseApp {
       token = getInstallationToken(workspace)
   } else {
       token = getUserOAuthToken(user)
   }
   ```

4. **Migrate users incrementally**:
   - Prompt users to "Upgrade to Organization GitHub Integration"
   - Admin installs app
   - Users stop using personal OAuth

5. **Remove user OAuth**:
   - After all users migrated
   - Delete user OAuth code
   - Remove migration flag

---

## References

- **GitHub Apps**: https://docs.github.com/en/apps/creating-github-apps
- **Installation Tokens**: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token
- **Webhooks**: https://docs.github.com/en/webhooks
- **Implementation Plan**: `docs/plans/2025-11-13-github-app-installation.md`
- **User OAuth (different pattern)**: `.agent/SOPs/user-oauth-integrations.md`

---

**This SOP is a constitutional requirement for all organization-level integrations.**
