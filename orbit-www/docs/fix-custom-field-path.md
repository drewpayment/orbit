# Fix: Custom Field Component Path Issue

## Problem
After adding the custom `WorkspaceKnowledgeField` component to the Workspaces collection, Payload threw an error about the component path format.

## Root Cause
Payload 3.x requires custom field components to be specified with an object containing `path` and `exportName` properties, not as a direct import or string path with `#` syntax.

## Solution

### Before (Incorrect)
```typescript
{
  name: 'knowledge',
  type: 'ui',
  label: 'Knowledge',
  admin: {
    components: {
      Field: '@/components/admin/fields/WorkspaceKnowledgeField#WorkspaceKnowledgeField',
    },
  },
}
```

### After (Correct)
```typescript
{
  name: 'knowledge',
  type: 'ui',
  label: 'Knowledge',
  admin: {
    components: {
      Field: {
        path: '/components/admin/fields/WorkspaceKnowledgeField',
        exportName: 'WorkspaceKnowledgeField',
      },
    },
  },
}
```

## Key Changes

1. **Path Format**: Use relative path from `src` directory without `@/` alias
2. **Object Structure**: Provide both `path` and `exportName` properties
3. **No Import**: Don't import the component in the collection file

## Component Export

The component must be exported as a named export:

```typescript
// src/components/admin/fields/WorkspaceKnowledgeField.tsx
export const WorkspaceKnowledgeField: React.FC = () => {
  // ... component code
}
```

## Testing

1. Restart dev server if it was running
2. Navigate to `/admin/collections/workspaces/[id]`
3. Verify the "Knowledge" section appears without errors
4. Test creating knowledge spaces from the workspace page

## References

- Payload 3.x Custom Components: https://payloadcms.com/docs/admin/components
- Custom Fields: https://payloadcms.com/docs/admin/fields
