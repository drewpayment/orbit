# Workspace Hierarchy Implementation

## Overview
This document describes the parent/child workspace relationship feature implemented in the Orbit IDP.

## Features Implemented

### 1. Data Model (Payload Collection)
**File:** `src/collections/Workspaces.ts`

Added two new relationship fields to the Workspaces collection:

- **`parentWorkspace`**: A single relationship field that allows a workspace to reference one parent workspace
- **`childWorkspaces`**: A multi-relationship field that allows a workspace to reference multiple child workspaces

### 2. Circular Reference Prevention
**File:** `src/collections/Workspaces.ts`

Implemented validation hooks in the `beforeValidate` lifecycle hook to prevent:

- **Self-references**: A workspace cannot be its own parent or child
- **Circular dependencies**: Prevents scenarios where Workspace A → B → C → A
- **Depth limits**: Maximum hierarchy depth of 20 levels to prevent infinite loops

The validation:
1. Checks for self-reference on both parent and child relationships
2. Traverses the parent chain to detect circular references
3. Throws descriptive errors when violations are detected

### 3. UI Display
**File:** `src/app/(frontend)/workspaces/[slug]/page.tsx`

Added a "Workspace Hierarchy" card in the sidebar that displays:

- **Parent Workspace**: Shows the parent workspace with avatar, name, and slug (if exists)
- **Child Workspaces**: Shows all child workspaces with avatars, names, and slugs (if exist)
- **Clickable Links**: All workspace relationships are clickable and navigate to the related workspace
- **Conditional Rendering**: The hierarchy card only appears if there are parent or child relationships

### 4. Data Fetching
**File:** `src/app/(frontend)/workspaces/[slug]/page.tsx`

Updated the workspace query to:
- Set `depth: 2` to fetch related workspaces (parent and children)
- Extract parent and child workspace objects for rendering
- Handle both populated objects and ID references

## Usage

### For Workspace Owners
Workspace owners can manage parent/child relationships through the Payload CMS admin interface:

1. Navigate to the Workspaces collection in Payload admin
2. Edit a workspace
3. **Option A**: Select a parent workspace from the "Parent Workspace" dropdown
   - The system will automatically add this workspace to the parent's children
4. **Option B**: Select child workspaces from the "Child Workspaces" multi-select
   - The system will automatically set this workspace as the parent for each child
5. Save - validation will prevent circular references

**Note**: You only need to set the relationship from one side. The system automatically syncs both directions.

### For Workspace Members
Members viewing a workspace will see:
- A "Workspace Hierarchy" section in the sidebar (if relationships exist)
- Clickable links to navigate to parent or child workspaces
- Visual hierarchy representation with avatars

## Technical Details

### Relationship Type
- **Bidirectional sync**: Relationships are automatically synchronized both ways
  - Setting Workspace A as parent of B automatically adds B to A's children
  - Adding Workspace C to B's children automatically sets B as C's parent
  - Removing relationships updates both sides automatically
- **Automatic consistency**: The system maintains data integrity through hooks
- **Single source of truth**: Either field can be modified, and the other side syncs automatically

### Validation Algorithm
The circular reference detection uses a depth-first traversal:
1. Start with the new parent/child being added
2. Build a visited set to track seen workspaces
3. Follow the parent chain up (or check child's parent chains)
4. If the current workspace is found in the chain, reject the change
5. Limit traversal to 20 levels to prevent performance issues

### Synchronization Logic
The `afterChange` hook handles bidirectional sync:
1. **Parent changes**: 
   - If parent removed: Remove this workspace from old parent's children
   - If parent added: Add this workspace to new parent's children
2. **Children changes**:
   - For added children: Set this workspace as their parent
   - For removed children: Remove this workspace as their parent
3. **Idempotent**: Only updates when necessary, prevents duplicate entries

### Performance Considerations
- Validation queries are only executed during workspace updates
- Front-end queries use `depth: 2` to fetch relationships in one query
- No additional API calls needed for displaying hierarchy

## Future Enhancements

Potential improvements:
- [ ] Bulk hierarchy operations
- [ ] Visual hierarchy tree view
- [ ] Hierarchy-based permissions
- [ ] Workspace templates that include hierarchy
- [ ] Search/filter by hierarchy level
- [ ] Move entire subtrees of workspaces

## Testing Recommendations

Test these scenarios:
1. ✅ Create parent/child relationships successfully
2. ✅ Verify bidirectional sync (set parent → child appears on parent)
3. ✅ Verify bidirectional sync (add child → parent set on child)
4. ✅ Prevent self-reference (A cannot be parent of A)
5. ✅ Prevent direct circular reference (A → B, then B → A should fail)
6. ✅ Prevent indirect circular reference (A → B → C, then C → A should fail)
7. ✅ Remove parent relationship (should remove child from parent's list)
8. ✅ Remove child relationship (should remove parent from child)
9. ✅ Display hierarchy in UI correctly
10. ✅ Navigate between related workspaces via links
11. ✅ Handle workspaces without relationships (no hierarchy card shown)

## Related Files
- `/Users/drew.payment/dev/idp/orbit-www/src/collections/Workspaces.ts` - Collection schema and validation
- `/Users/drew.payment/dev/idp/orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx` - UI display
