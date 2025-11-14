# SOP: User OAuth Integrations (Personal Services)

**Created**: 2025-01-13
**Last Updated**: 2025-11-13
**Trigger**: When implementing user-level OAuth integrations for personal services (Notion, Google Drive, etc.)

## Scope

This SOP covers **user-level OAuth integrations** for personal services where each user authorizes access to their **personal account**:

**✅ Use This Pattern For:**
- Notion (personal workspace)
- Google Drive (personal files)
- Slack (personal DMs, not workspace)
- Trello (personal boards)
- Linear (personal issues)
- Asana (personal tasks)

**❌ Do NOT Use This Pattern For:**
- GitHub → Use `.agent/SOPs/github-app-installation.md` (enterprise app pattern)
- Confluence → Use `.agent/SOPs/github-app-installation.md` (workspace-wide)
- Jira → Use `.agent/SOPs/github-app-installation.md` (organization-level)
- GitLab → Use `.agent/SOPs/github-app-installation.md` (organization-level)
- Other organization-level integrations → Follow GitHub App pattern

**When in doubt**: If an admin installs it for the whole organization → GitHub App pattern. If each user connects their personal account → This SOP.

---

## Purpose

This SOP defines the pattern for **user-level OAuth integrations** where:
- Each user authorizes access to their personal account
- Operations execute using that specific user's OAuth token
- User's personal data/permissions apply
- No admin installation required

This differs from **organization-level app installations** (GitHub, Confluence) where an admin installs an app for the entire workspace. See `.agent/SOPs/github-app-installation.md` for that pattern.

---

## Core Principle

**User-Context Authentication**: User-level operations MUST execute with the authenticated user's OAuth credentials.

## Why This Matters

For personal services:
- Each user has their own Notion workspace
- Each user's Google Drive contains their personal files
- User's Slack account is personal to them
- Cannot share credentials across workspace users

**Example: Notion Integration**
- Alice connects her Notion account
- Bob connects his Notion account
- When Alice syncs knowledge to Notion → Uses Alice's token → Writes to Alice's Notion workspace
- When Bob syncs knowledge to Notion → Uses Bob's token → Writes to Bob's Notion workspace

**This differs from GitHub** where:
- Admin installs GitHub App → All users in workspace share the installation
- Operations use bot token → Repos created in org, not personal account
- See `.agent/SOPs/github-app-installation.md` for that pattern

---

## When to Use User OAuth vs Organization App

| Criteria | User OAuth (This SOP) | Org App (GitHub App SOP) |
|----------|----------------------|--------------------------|
| Who installs? | Each user individually | Admin once for org |
| Token ownership | User's personal token | Organization bot token |
| Operations execute as | The user | Bot (e.g., "Orbit IDP Bot") |
| Data scope | User's personal data | Organization's data |
| Sharing across users | ❌ No | ✅ Yes |
| Examples | Notion, Google Drive | GitHub, Confluence, Jira |

---

## User OAuth Not Needed for GitHub

**IMPORTANT**: As of 2025-11-13, GitHub uses the **organization app installation pattern**, not user OAuth.

**Rationale from brainstorming session:**
- User said: "I think we could go with Option A because I don't think we have a lot of user-oriented actions beyond deploying a git repository initially"
- Commits show: "Orbit IDP <bot@orbit.dev>" with username in message
- Workspace admin controls repository access via GitHub App installation
- No need for individual user GitHub permissions

**Therefore**: Remove GitHub-specific content from this SOP's implementation sections. It's kept in "When NOT to use" for clarity.

---

## Activities Requiring User OAuth

### **Personal Service Integrations**
- **SyncToNotionActivity**: User's Notion integration token
- **SyncToGoogleDriveActivity**: User's Google OAuth token
- **SendSlackDMActivity**: User's Slack OAuth token (not workspace Slack app)

### **Code Generation & Registries**
- **GenerateCodeActivity** (future):
  - Private npm: User's npm token
  - Private Maven: User's credentials
  - Private PyPI: User's token

### **Database & Internal Services**
- **All data access**: Scoped to user's workspace (row-level security)
- **Background jobs**: Initiated with user context, run as that user

## Implementation Pattern

### 1. Workflow Inputs Include User Context

**REQUIRED for ALL workflow inputs:**

```go
type RepositoryWorkflowInput struct {
    RepositoryID string
    UserID       string      // From JWT/session (REQUIRED)
    WorkspaceID  string      // Multi-tenant scope (REQUIRED)
    TemplateName string
    Variables    map[string]string
    GitURL       string
}

type KnowledgeSyncWorkflowInput struct {
    SpaceID      string
    System       string
    UserID       string      // REQUIRED
    WorkspaceID  string      // REQUIRED
}
```

### 2. Activity Inputs Include User Context

**REQUIRED for ALL activity inputs:**

```go
type PushToRemoteInput struct {
    RepositoryID string
    UserID       string      // Pass through from workflow (REQUIRED)
    WorkspaceID  string      // For multi-tenant credential lookup (REQUIRED)
}

type SyncToExternalSystemInput struct {
    Pages        []TransformedPage
    System       string
    UserID       string      // Who initiated the sync (REQUIRED)
    WorkspaceID  string      // Which workspace's credentials to use (REQUIRED)
}
```

### 3. Activity Dependencies

**REQUIRED for ALL activities needing external auth:**

```go
type GitActivities struct {
    workDir           string
    credentialService CredentialService  // REQUIRED
}

type KnowledgeSyncActivities struct {
    credentialService CredentialService  // REQUIRED
}

func NewGitActivities(workDir string, credService CredentialService) *GitActivities {
    return &GitActivities{
        workDir:           workDir,
        credentialService: credService,
    }
}
```

### 4. Activities Retrieve User Credentials

**Pattern for Git operations:**

```go
func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
    repoPath := filepath.Join(a.workDir, input.RepositoryID)

    // REQUIRED: Retrieve user's OAuth token
    creds, err := a.credentialService.GetUserCredentials(ctx, input.UserID, "github")
    if err != nil {
        return fmt.Errorf("user has not connected GitHub account: %w", err)
    }

    // Verify token not expired, refresh if needed
    if creds.IsExpired() {
        creds, err = a.credentialService.RefreshToken(ctx, input.UserID, "github")
        if err != nil {
            return fmt.Errorf("failed to refresh GitHub token: %w", err)
        }
    }

    // Configure Git credential helper to use user's token
    cmd := exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
    cmd.Dir = repoPath
    cmd.Env = append(os.Environ(),
        // Use temporary credential helper that provides user's token
        fmt.Sprintf("GIT_ASKPASS=%s", a.buildCredentialHelper(creds.AccessToken)),
        // Optional: Set user identity for commits (if not already configured)
        "GIT_AUTHOR_NAME="+creds.UserName,
        "GIT_AUTHOR_EMAIL="+creds.UserEmail,
    )

    output, err := cmd.CombinedOutput()
    if err != nil {
        return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
    }

    return nil
}

// buildCredentialHelper creates a temporary script that echoes the token
func (a *GitActivities) buildCredentialHelper(token string) string {
    // Create temporary script that Git will call for credentials
    // Script simply echoes the OAuth token
    // This is more secure than putting token in environment or command line
    script := fmt.Sprintf("#!/bin/sh\necho %s", token)
    tmpFile, _ := os.CreateTemp("", "git-cred-*")
    os.WriteFile(tmpFile.Name(), []byte(script), 0700)
    return tmpFile.Name()
}
```

**Pattern for external APIs:**

```go
func (a *KnowledgeSyncActivities) SyncToExternalSystemActivity(ctx context.Context, input SyncToExternalSystemInput) error {
    // REQUIRED: Retrieve workspace integration credentials
    integration, err := a.credentialService.GetWorkspaceIntegration(
        ctx,
        input.WorkspaceID,
        input.System,
    )
    if err != nil {
        return fmt.Errorf("workspace has not configured %s integration: %w", input.System, err)
    }

    switch input.System {
    case "confluence":
        return a.syncToConfluence(ctx, input.Pages, integration)
    case "notion":
        return a.syncToNotion(ctx, input.Pages, integration)
    default:
        return fmt.Errorf("unsupported system: %s", input.System)
    }
}

func (a *KnowledgeSyncActivities) syncToConfluence(ctx context.Context, pages []TransformedPage, integration *IntegrationCredentials) error {
    // Use workspace's Confluence credentials
    client := confluence.NewClient(integration.BaseURL, integration.APIKey)

    for _, page := range pages {
        if err := client.CreateOrUpdatePage(ctx, page); err != nil {
            return fmt.Errorf("failed to sync page %s: %w", page.ID, err)
        }
    }

    return nil
}
```

## Credential Service Interface

**REQUIRED service for all activities:**

```go
// CredentialService manages user OAuth tokens and workspace integrations
type CredentialService interface {
    // User OAuth tokens (GitHub, GitLab, etc.)
    GetUserCredentials(ctx context.Context, userID, provider string) (*OAuthCredentials, error)
    StoreUserCredentials(ctx context.Context, userID, provider string, creds *OAuthCredentials) error
    RefreshToken(ctx context.Context, userID, provider string) (*OAuthCredentials, error)
    RevokeUserCredentials(ctx context.Context, userID, provider string) error

    // Workspace integrations (Confluence, Notion, etc.)
    GetWorkspaceIntegration(ctx context.Context, workspaceID, system string) (*IntegrationCredentials, error)
    StoreWorkspaceIntegration(ctx context.Context, workspaceID, system string, integration *IntegrationCredentials) error
    DeleteWorkspaceIntegration(ctx context.Context, workspaceID, system string) error
}

type OAuthCredentials struct {
    AccessToken  string
    RefreshToken string
    ExpiresAt    time.Time
    Scopes       []string
    UserName     string    // For Git author
    UserEmail    string    // For Git author
}

func (c *OAuthCredentials) IsExpired() bool {
    return time.Now().After(c.ExpiresAt.Add(-5 * time.Minute)) // 5min buffer
}

type IntegrationCredentials struct {
    APIKey       string
    BaseURL      string
    ConfiguredBy string    // UserID who configured
    Config       map[string]interface{}  // System-specific config
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```

## Database Schema

**REQUIRED tables for credential storage:**

```sql
-- User OAuth tokens (GitHub, GitLab, etc.)
-- Tokens MUST be encrypted at rest using application-level encryption
CREATE TABLE user_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'github', 'gitlab', 'bitbucket'
    access_token TEXT NOT NULL,     -- Encrypted using app key
    refresh_token TEXT,             -- Encrypted using app key
    expires_at TIMESTAMP,
    scopes TEXT[],
    user_name VARCHAR(255),         -- For Git commits
    user_email VARCHAR(255),        -- For Git commits
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

CREATE INDEX idx_user_oauth_tokens_user_provider ON user_oauth_tokens(user_id, provider);

-- Workspace integrations (Confluence, Notion, etc.)
-- API keys MUST be encrypted at rest
CREATE TABLE workspace_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system VARCHAR(50) NOT NULL,    -- 'confluence', 'notion', 'jira'
    api_key TEXT NOT NULL,          -- Encrypted using app key
    base_url TEXT,
    config JSONB,                   -- System-specific configuration
    configured_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, system)
);

CREATE INDEX idx_workspace_integrations_workspace_system ON workspace_integrations(workspace_id, system);
```

**Encryption Requirements:**
- Use application-level encryption (e.g., `pgcrypto` with app-managed keys)
- Never store tokens in plaintext
- Rotate encryption keys regularly
- Audit all credential access

## Frontend Integration (OAuth Flow)

**User connects their GitHub account:**

1. User clicks "Connect GitHub" in settings
2. Frontend redirects to GitHub OAuth:
   ```
   https://github.com/login/oauth/authorize?
     client_id=<app_client_id>&
     redirect_uri=https://orbit.dev/oauth/github/callback&
     scope=repo,user:email
   ```
3. User authorizes, GitHub redirects back with code
4. Frontend calls backend: `POST /api/oauth/github/callback { code }`
5. Backend exchanges code for access token
6. Backend stores encrypted token in `user_oauth_tokens`
7. Frontend shows "✓ GitHub Connected"

**Workspace configures Confluence integration:**

1. Admin clicks "Configure Integrations" in workspace settings
2. Enters Confluence base URL and API key
3. Frontend calls: `POST /api/workspaces/{id}/integrations/confluence`
4. Backend validates credentials (test API call)
5. Backend stores encrypted credentials in `workspace_integrations`
6. Frontend shows "✓ Confluence Connected"

## Error Handling

**When user hasn't connected required service:**

```go
creds, err := a.credentialService.GetUserCredentials(ctx, input.UserID, "github")
if err != nil {
    // Return user-friendly error
    return &workflow.ApplicationError{
        Message: "GitHub account not connected. Please connect your GitHub account in Settings.",
        Type:    "CREDENTIALS_NOT_FOUND",
    }
}
```

**When credentials are expired and refresh fails:**

```go
if creds.IsExpired() {
    creds, err = a.credentialService.RefreshToken(ctx, input.UserID, "github")
    if err != nil {
        return &workflow.ApplicationError{
            Message: "Your GitHub authorization has expired. Please reconnect your GitHub account.",
            Type:    "CREDENTIALS_EXPIRED",
        }
    }
}
```

**When workspace integration not configured:**

```go
integration, err := a.credentialService.GetWorkspaceIntegration(ctx, input.WorkspaceID, "confluence")
if err != nil {
    return &workflow.ApplicationError{
        Message: "Confluence integration not configured. Please configure it in Workspace Settings.",
        Type:    "INTEGRATION_NOT_CONFIGURED",
    }
}
```

## Security Requirements

1. **Token Encryption**: All tokens MUST be encrypted at rest
2. **Transport Security**: All OAuth exchanges use HTTPS
3. **Token Rotation**: Support OAuth refresh tokens
4. **Scope Limitation**: Request minimum required OAuth scopes
5. **Audit Logging**: Log all credential access (not the tokens themselves)
6. **Revocation**: Allow users to disconnect accounts
7. **Multi-Factor**: Support MFA for sensitive operations

## Exceptions (Service Accounts)

Service accounts are **ONLY** permitted for:

1. **Infrastructure operations** (monitoring, backups, system health checks)
2. **Internal service-to-service** (gRPC service auth, not external APIs)
3. **Explicitly documented exceptions** (requires architectural review)

**Process for requesting exception:**
1. Document why user-context is not possible
2. Identify security risks and mitigations
3. Get approval from tech lead
4. Document in code comments and this SOP

## Testing Strategy

**Unit tests MUST mock credential service:**

```go
func TestPushToRemoteActivity(t *testing.T) {
    mockCredService := &MockCredentialService{
        Credentials: map[string]*OAuthCredentials{
            "user-123:github": {
                AccessToken:  "ghp_test_token",
                RefreshToken: "refresh_token",
                ExpiresAt:    time.Now().Add(24 * time.Hour),
                UserName:     "testuser",
                UserEmail:    "test@example.com",
            },
        },
    }

    activities := NewGitActivities("/tmp/test", mockCredService)

    err := activities.PushToRemoteActivity(context.Background(), PushToRemoteInput{
        RepositoryID: "repo-123",
        UserID:       "user-123",
        WorkspaceID:  "workspace-123",
    })

    require.NoError(t, err)
    assert.True(t, mockCredService.GetUserCredentialsCalled)
}
```

**Integration tests use real OAuth flow:**
- Set up test user with actual GitHub token
- Use `SKIP_INTEGRATION_TESTS` env var to skip in CI

## Migration from Service Accounts

**If existing code uses service accounts:**

1. Add `UserID` and `WorkspaceID` to all workflow inputs
2. Add `credentialService` dependency to activities
3. Update activity implementations to use user credentials
4. Add database tables for credential storage
5. Implement OAuth flows in frontend
6. Provide migration path for existing users

## References

- **OAuth 2.0 RFC**: https://datatracker.ietf.org/doc/html/rfc6749
- **GitHub OAuth**: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps
- **GitLab OAuth**: https://docs.gitlab.com/ee/api/oauth2.html
- **Confluence API**: https://developer.atlassian.com/cloud/confluence/rest/
- **Notion API**: https://developers.notion.com/

## Checklist

When implementing ANY feature requiring external auth:

- [ ] Workflow input includes `UserID` and `WorkspaceID`
- [ ] Activity inputs include `UserID` and `WorkspaceID`
- [ ] Activity has `credentialService` dependency
- [ ] Activity retrieves user credentials (never uses env vars)
- [ ] Error handling for missing/expired credentials
- [ ] Database tables for credential storage exist
- [ ] Frontend OAuth flow implemented
- [ ] Tokens encrypted at rest
- [ ] Tests mock credential service
- [ ] Documentation updated with required OAuth scopes

---

**This SOP is a constitutional requirement. Deviation requires architectural review and explicit approval.**
