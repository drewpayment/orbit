# Workspace Management Implementation

## Overview

This document describes the workspace management foundation that has been implemented for the Orbit Internal Developer Portal. The implementation includes authentication, authorization (RBAC), and multi-tenant workspace capabilities.

## What Was Built

### 1. Authentication System (Better Auth)

**Files Created:**
- `orbit-www/src/lib/auth.ts` - Server-side Better Auth configuration
- `orbit-www/src/lib/auth-client.ts` - Client-side auth utilities
- `orbit-www/src/app/api/auth/[...all]/route.ts` - Auth API handler
- `orbit-www/src/app/(auth)/layout.tsx` - Auth pages layout
- `orbit-www/src/app/(auth)/login/page.tsx` - Login page
- `orbit-www/src/app/(auth)/signup/page.tsx` - Signup page

**Features:**
- Email/password authentication using Better Auth
- MongoDB-backed session storage
- 7-day session expiration with automatic renewal
- User signup with name, email, and password
- Integrated with existing Payload Users collection

**Dependencies Added:**
- `better-auth` - Modern authentication library
- `mongodb` - MongoDB client for Better Auth adapter

### 2. Payload Collections

**Collections Created:**

#### Users (Enhanced)
- `name` - Full name field
- `avatar` - Profile picture upload
- Uses Payload's built-in auth system for admin access
- Better Auth manages authentication for frontend users

#### Workspaces
Location: `orbit-www/src/collections/Workspaces.ts`

Fields:
- `name` - Workspace display name
- `slug` - URL-friendly identifier (unique)
- `description` - Optional workspace description
- `avatar` - Workspace logo/avatar
- `settings` - Nested group containing:
  - `enabledPlugins` - Array of plugin configurations
  - `customization` - JSON for UI theming

Access Control:
- Read: Public (everyone can view workspaces)
- Create: Authenticated users only
- Update: Workspace owners/admins only
- Delete: Workspace owners only

Hooks:
- `afterChange`: Automatically creates owner membership when workspace is created

#### WorkspaceMembers
Location: `orbit-www/src/collections/WorkspaceMembers.ts`

Fields:
- `workspace` - Relationship to Workspaces
- `user` - Relationship to Users
- `role` - Enum: 'owner', 'admin', 'member'
- `status` - Enum: 'active', 'pending', 'rejected'
- `requestedAt` - Timestamp of join request
- `approvedAt` - Timestamp of approval
- `approvedBy` - User who approved the request

Indexes:
- Unique constraint on (workspace, user) combination

Access Control:
- Read: Users can see memberships for workspaces they belong to
- Create: Authenticated users (for join requests)
- Update: Workspace admins/owners (for approvals)
- Delete: Users can leave workspaces; owners can remove members

### 3. API Endpoints

**Workspaces API**
- `GET /api/workspaces` - List all workspaces (with optional filters)
- `POST /api/workspaces` - Create new workspace

**Workspace Members API**
- `GET /api/workspace-members` - List memberships (filterable by workspace, user, status)
- `POST /api/workspace-members` - Create membership request
- `PATCH /api/workspace-members/[id]` - Approve/reject membership
- `DELETE /api/workspace-members/[id]` - Remove membership

### 4. User Interface

**Dashboard Page**
Location: `orbit-www/src/app/(frontend)/dashboard/page.tsx`

Features:
- Company-wide landing page for users not in a workspace
- Quick action cards for getting started
- Resource links
- Preview of available workspaces
- Protected route (redirects to login if not authenticated)

**Workspace Overview Page**
Location: `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

Features:
- Dynamic routing by workspace slug
- Workspace header with name, description, and avatar
- Member list grouped by role (owners, admins, members)
- "Request to Join" button for non-members
- "Request Pending" status for pending requests
- Member-only features section (placeholder for future functionality)
- Responsive layout with Backstage-inspired design

**Auth Pages**
- `/login` - Email/password login with error handling
- `/signup` - User registration with password confirmation

## RBAC (Role-Based Access Control)

### Roles

1. **Owner**
   - Full control over workspace
   - Can delete workspace
   - Can manage all members
   - Automatically assigned to workspace creator

2. **Admin**
   - Can approve/reject join requests
   - Can manage members
   - Can update workspace settings
   - Cannot delete workspace

3. **Member**
   - Can view workspace content
   - Can edit workspace content (future)
   - Cannot manage other members
   - Cannot change workspace settings

### Membership Workflow

1. User browses public workspace directory
2. User clicks "Request to Join" on a workspace
3. Request is created with status='pending'
4. Workspace admin/owner sees pending request
5. Admin approves → status='active', approvedAt timestamp set
6. User gains access to member features

## Multi-Tenancy Model

- **Workspace Isolation**: Each workspace is a logical unit/group
- **Public Visibility**: All users can view all workspaces (read access)
- **Membership-Based Write Access**: Only workspace members can edit content
- **Flexible Membership**: Users can belong to multiple workspaces
- **Role Scoping**: User roles are scoped to specific workspaces

## Configuration

### Environment Variables

```env
DATABASE_URI=mongodb://127.0.0.1:27017/orbit-www
PAYLOAD_SECRET=f0441e9d911d3bad9c9d087d
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Payload Config Updates

Added collections to `orbit-www/src/payload.config.ts`:
```typescript
collections: [Users, Media, Workspaces, WorkspaceMembers]
```

## Next Steps

To complete the workspace management foundation, consider implementing:

1. **Workspace Settings Pages**
   - Member management UI for admins
   - Pending request approvals
   - Workspace settings editor
   - Plugin configuration

2. **Enhanced Member Management**
   - Invite users via email
   - Bulk member operations
   - Role change functionality
   - Member removal

3. **Workspace Features**
   - Wiki/documentation editor
   - Plugin system
   - Repository integration
   - API catalog integration

4. **Admin Dashboard**
   - Pending requests panel
   - Member activity tracking
   - Workspace analytics

5. **Security Enhancements**
   - Email verification for signups
   - Password reset functionality
   - Session management UI
   - Audit logging

6. **Better Auth Middleware**
   - Server-side session validation
   - Protected API routes
   - User context in API handlers

## Testing

To test the implementation:

1. **Start MongoDB**:
   ```bash
   # Ensure MongoDB is running on localhost:27017
   ```

2. **Start Development Server**:
   ```bash
   cd orbit-www
   bun dev
   ```

3. **Test User Flow**:
   - Visit `/signup` to create an account
   - Visit `/login` to sign in
   - Visit `/dashboard` to see company landing page
   - Visit `/workspaces` to browse workspaces
   - Create a workspace (you become owner)
   - Log in as different user
   - Request to join the workspace
   - Log back in as owner
   - Approve the join request via Payload admin panel (member management UI coming soon)

4. **Access Payload Admin**:
   - Visit `/admin`
   - Use Payload admin credentials
   - Manage workspaces, members, and users

## Architecture Notes

- **Better Auth** manages frontend authentication
- **Payload Auth** still manages admin panel access
- Users exist in Payload's `users` collection
- Better Auth creates sessions in MongoDB's `sessions` collection
- All workspace operations go through Payload's access control
- Frontend uses generated TypeScript types from Payload

## Files Modified

- `orbit-www/package.json` - Added better-auth, mongodb
- `orbit-www/src/payload.config.ts` - Registered new collections
- `orbit-www/src/collections/Users.ts` - Added name and avatar fields
- `orbit-www/.env` - Added NEXT_PUBLIC_APP_URL

## Files Created

Authentication:
- `orbit-www/src/lib/auth.ts`
- `orbit-www/src/lib/auth-client.ts`
- `orbit-www/src/app/api/auth/[...all]/route.ts`
- `orbit-www/src/app/(auth)/layout.tsx`
- `orbit-www/src/app/(auth)/login/page.tsx`
- `orbit-www/src/app/(auth)/signup/page.tsx`

Collections:
- `orbit-www/src/collections/Workspaces.ts`
- `orbit-www/src/collections/WorkspaceMembers.ts`

API:
- `orbit-www/src/app/api/workspaces/route.ts`
- `orbit-www/src/app/api/workspace-members/route.ts`
- `orbit-www/src/app/api/workspace-members/[id]/route.ts`

UI:
- `orbit-www/src/app/(frontend)/dashboard/page.tsx`
- `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

## Known Limitations

1. **No Email Service**: Email verification is disabled, password reset not implemented
2. **Manual Approval**: Member approval requires using Payload admin panel (no UI yet)
3. **No Middleware**: Better Auth session validation not integrated with API routes
4. **Basic Error Handling**: Frontend error states are minimal
5. **No Workspace Deletion**: UI doesn't expose workspace deletion yet
6. **Limited Testing**: No automated tests written yet

## Dependencies

```json
{
  "dependencies": {
    "better-auth": "^1.3.26",
    "mongodb": "^6.20.0"
  }
}
```
