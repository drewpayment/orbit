# Feature: Workspace Management

**Status**: Completed
**Date**: 2025-01-15
**Implementation Time**: 6 hours
**Branch**: feat/ui-workspace-management

## Requirements (PRD)

### User Stories
- As an admin, I want to create workspaces to organize tenant data
- As an admin, I want to view all workspaces with their metadata
- As an admin, I want to edit workspace details (name, slug)
- As an admin, I want to delete workspaces that are no longer needed
- As a user, I want to see which workspace I'm currently viewing

### Technical Requirements
- Multi-tenant workspace model in Payload CMS
- Workspace slug must be unique and URL-safe
- Admin-only UI for workspace management at `/admin/workspaces`
- RESTful API through Payload collections (future: migrate to gRPC)
- Soft delete support with confirmation dialog

### Business Rules
- Workspace slugs must be lowercase, alphanumeric, and hyphen-separated
- Workspace names must be 3-100 characters
- Cannot delete workspace with active resources (future enforcement)
- System workspace cannot be deleted

## Implementation Plan

### 1. Database Schema (Payload Collection)

#### Workspace Collection
`orbit-www/src/collections/Workspaces.ts`:

```typescript
import { CollectionConfig } from 'payload'

export const Workspaces: CollectionConfig = {
  slug: 'workspaces',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => user?.role === 'admin',
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'URL-safe identifier (e.g., "acme-corp")',
      },
      validate: (val) => {
        if (!/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: false,
    },
  ],
}
```

### 2. Files Created/Modified

#### Created
- `orbit-www/src/collections/Workspaces.ts` - Payload collection definition
- `orbit-www/src/app/(admin)/admin/workspaces/page.tsx` - Admin workspace list UI
- `orbit-www/src/app/(admin)/admin/workspaces/[id]/page.tsx` - Workspace detail/edit UI
- `orbit-www/src/app/(admin)/admin/workspaces/new/page.tsx` - Create workspace form
- `orbit-www/src/components/workspaces/workspace-form.tsx` - Reusable form component
- `orbit-www/src/components/workspaces/workspace-list.tsx` - Table component
- `orbit-www/src/components/workspaces/delete-workspace-dialog.tsx` - Confirmation dialog

#### Modified
- `orbit-www/src/payload.config.ts` - Added Workspaces collection
- `orbit-www/src/collections/Users.ts` - Added workspace relation field
- `orbit-www/src/app/(admin)/layout.tsx` - Added workspaces navigation link

### 3. Implementation Steps

#### Phase 1: Collection Setup ✅
1. Created Workspaces collection with validation rules
2. Added to payload.config.ts collections array
3. Ran Payload to generate database migration
4. Tested collection CRUD via Payload Admin UI

#### Phase 2: Admin UI ✅
1. Created workspace list page at `/admin/workspaces`
2. Implemented shadcn/ui Table component for workspace display
3. Added filtering and sorting capabilities
4. Created "New Workspace" button with routing

#### Phase 3: Form Components ✅
1. Built WorkspaceForm with React Hook Form + Zod validation
2. Implemented slug auto-generation from name (kebab-case)
3. Added client-side validation matching collection rules
4. Integrated with Payload REST API for submissions

#### Phase 4: Edit/Delete ✅
1. Created workspace detail page with edit form
2. Implemented delete confirmation dialog with warning
3. Added error handling for delete failures (e.g., workspace in use)
4. Added success/error toast notifications

#### Phase 5: User Relations ✅
1. Added workspace relationship field to Users collection
2. Updated user profile to display current workspace
3. Added workspace switcher component (future: multi-workspace support)

### 4. Key Code Patterns

#### Slug Generation
```typescript
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

#### Form Validation (Zod Schema)
```typescript
const workspaceSchema = z.object({
  name: z.string().min(3).max(100),
  slug: z.string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().optional(),
});
```

#### Payload API Integration
```typescript
async function createWorkspace(data: WorkspaceFormData) {
  const response = await fetch('/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create workspace');
  }

  return response.json();
}
```

#### Delete Confirmation Pattern
```typescript
function DeleteWorkspaceDialog({ workspace, onSuccess }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
      });
      toast.success('Workspace deleted successfully');
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete "{workspace.name}". This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

## Testing Strategy

### Manual Testing ✅
- [x] Create workspace with valid data
- [x] Create workspace with duplicate slug (should fail)
- [x] Create workspace with invalid slug characters (should fail)
- [x] Edit workspace name and slug
- [x] Delete workspace with confirmation
- [x] Cancel delete operation
- [x] Verify slug uniqueness validation
- [x] Test slug auto-generation from name

### Future Automated Tests
```typescript
// Vitest component test
describe('WorkspaceForm', () => {
  it('auto-generates slug from name', () => {
    render(<WorkspaceForm />);
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Acme Corp!' } });
    const slugInput = screen.getByLabelText('Slug');
    expect(slugInput).toHaveValue('acme-corp');
  });

  it('validates slug format', async () => {
    render(<WorkspaceForm />);
    const slugInput = screen.getByLabelText('Slug');
    fireEvent.change(slugInput, { target: { value: 'Invalid Slug!' } });
    fireEvent.blur(slugInput);
    await waitFor(() => {
      expect(screen.getByText(/must contain only lowercase/)).toBeInTheDocument();
    });
  });
});
```

## Lessons Learned

### What Worked Well
- **Payload Collections**: Rapid prototyping with built-in validation and admin UI
- **shadcn/ui Components**: Consistent, accessible UI components
- **Slug Auto-Generation**: UX improvement that reduces user errors
- **Delete Confirmation**: Prevents accidental deletions
- **Toast Notifications**: Clear feedback for user actions

### Challenges & Solutions

#### Challenge 1: Slug Uniqueness Validation
**Problem**: Client-side validation didn't catch duplicate slugs until form submission.
**Solution**: Added debounced async validation to check slug availability in real-time.

```typescript
const checkSlugAvailability = useMemo(
  () =>
    debounce(async (slug: string) => {
      const response = await fetch(`/api/workspaces/check-slug?slug=${slug}`);
      return response.ok;
    }, 500),
  []
);
```

#### Challenge 2: Routing Structure
**Problem**: Initial implementation used `/workspaces` which conflicted with public routes.
**Solution**: Moved to `/admin/workspaces` for clearer separation and security.

#### Challenge 3: User Workspace Relations
**Problem**: Users collection didn't initially support workspace relationships.
**Solution**: Added relationship field with `hasMany: false` to enforce single workspace per user.

```typescript
{
  name: 'workspace',
  type: 'relationship',
  relationTo: 'workspaces',
  hasMany: false,
  required: true,
}
```

### Future Improvements
1. **Migrate to gRPC**: Replace Payload REST API with gRPC Workspace Service
2. **Multi-Workspace Support**: Allow users to belong to multiple workspaces
3. **Workspace Templates**: Pre-configured workspace types (e.g., "Development", "Production")
4. **Workspace Analytics**: Track resource usage per workspace
5. **Bulk Operations**: Delete/export multiple workspaces
6. **Workspace Invitations**: Invite users to join workspaces
7. **Resource Validation**: Prevent deletion of workspaces with active repositories/APIs

## Migration Path to gRPC

### Current Architecture
```
Frontend → Payload REST API → PostgreSQL
```

### Future Architecture (Planned)
```
Frontend → gRPC Workspace Service → PostgreSQL
         ↓
      Payload CMS (authentication/authorization only)
```

### Migration Steps
1. Create `proto/workspace.proto` service definition
2. Implement Go workspace service in `services/workspace/`
3. Keep Payload collection for backward compatibility
4. Update frontend to use gRPC client
5. Deprecate Payload REST endpoints
6. Remove Payload collection (keep Users collection for auth)

## Related Documentation
- See: [../system/project-structure.md](../system/project-structure.md) for monorepo layout
- See: [../SOPs/adding-grpc-services.md](../SOPs/adding-grpc-services.md) for future gRPC migration
- See: [../SOPs/error-handling.md](../SOPs/error-handling.md) for error patterns used

## Metrics & Impact
- **Development Time**: 6 hours (including design iteration)
- **Lines of Code**: ~800 (TypeScript + TSX)
- **API Endpoints**: 5 (Payload REST: list, create, read, update, delete)
- **User Impact**: Enables multi-tenant workspace isolation for all future features
