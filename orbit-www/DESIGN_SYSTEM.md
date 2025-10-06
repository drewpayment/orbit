# Orbit IDP Design System

This document outlines the design system patterns, conventions, and best practices for building UI components in the Orbit Internal Developer Portal.

## Overview

The Orbit design system is built on:
- **shadcn/ui**: Component library for consistent, accessible UI components
- **Tailwind CSS**: Utility-first CSS framework
- **Radix UI**: Unstyled, accessible component primitives
- **Next.js 15**: React framework with App Router
- **Payload CMS**: Headless CMS for content management

## Design Principles

1. **Consistency**: All components follow the same design patterns and conventions
2. **Accessibility**: WCAG 2.1 AA compliant, keyboard navigable, screen reader friendly
3. **Responsiveness**: Mobile-first approach, works across all device sizes
4. **Friendliness**: Clear, helpful messaging with appropriate visual feedback
5. **Performance**: Optimized for fast loading and smooth interactions

## Color System

We use HSL color tokens for flexible theming support:

### Light Theme
- **Background**: `hsl(0 0% 100%)` - Pure white
- **Foreground**: `hsl(240 10% 3.9%)` - Near black
- **Primary**: `hsl(240 5.9% 10%)` - Dark gray
- **Secondary**: `hsl(240 4.8% 95.9%)` - Light gray
- **Destructive**: `hsl(0 84.2% 60.2%)` - Red for warnings/errors
- **Muted**: `hsl(240 4.8% 95.9%)` - Subtle backgrounds
- **Border**: `hsl(240 5.9% 90%)` - Component borders

### Dark Theme
Dark mode is supported via the `.dark` class. All color tokens automatically adapt.

## Typography

- **Font Family**: System font stack for optimal performance
- **Base Size**: 18px (desktop), 15px (mobile)
- **Line Height**: 32px (desktop), 24px (mobile)
- **Headings**: Bold weight, responsive sizing
- **Monospace**: Roboto Mono for code snippets

## Component Patterns

### Feature Components

Feature components are the main building blocks of the application. They are located in `src/components/features/` and organized by domain:

```
src/components/features/
  workspace/
    WorkspaceManager.tsx       # Main container component
    WorkspaceList.tsx          # List view component
    CreateWorkspaceDialog.tsx  # Create dialog component
    WorkspaceSettingsDialog.tsx # Settings dialog component
    MemberManagementDialog.tsx # Member management component
```

#### Component Structure

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface ComponentProps {
  // Props with clear types
}

export function FeatureComponent({ prop1, prop2 }: ComponentProps) {
  // State management
  const [state, setState] = useState()

  // Event handlers
  const handleAction = async () => {
    // Implementation
  }

  // Render
  return (
    <div className="space-y-4">
      {/* Component markup */}
    </div>
  )
}
```

### UI Components

Base UI components from shadcn/ui are located in `src/components/ui/`. These are generated and should not be manually edited:

- **Button**: Primary actions, secondary actions, ghost, outline variants
- **Card**: Container for grouped content
- **Dialog**: Modal dialogs for forms and confirmations
- **Form**: Form handling with react-hook-form and Zod validation
- **Input**: Text input fields
- **Select**: Dropdown selection
- **Table**: Data tables with sorting and filtering
- **Badge**: Status indicators and labels
- **Avatar**: User profile images with fallback initials

### Layout Patterns

#### Dashboard Layout
```typescript
<div className="flex h-screen flex-col">
  {/* Header */}
  <div className="border-b bg-background">
    <div className="flex h-16 items-center justify-between px-6">
      <div>
        <h1 className="text-2xl font-bold">Title</h1>
        <p className="text-sm text-muted-foreground">Description</p>
      </div>
      <Button>Action</Button>
    </div>
  </div>

  {/* Main Content */}
  <div className="flex flex-1 overflow-hidden">
    <div className="flex-1 overflow-y-auto p-6">
      {/* Content */}
    </div>
  </div>
</div>
```

#### Card Grid
```typescript
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map((item) => (
    <Card key={item.id}>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
      </CardHeader>
      <CardContent>{item.content}</CardContent>
    </Card>
  ))}
</div>
```

### Form Patterns

All forms use react-hook-form with Zod validation:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'

const schema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  email: z.string().email('Invalid email address'),
})

type FormData = z.infer<typeof schema>

export function MyForm() {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
    },
  })

  const onSubmit = async (data: FormData) => {
    // Handle submission
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
```

### Loading States

Use consistent loading indicators:

```typescript
{isLoading && (
  <div className="flex items-center gap-2 text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
    <span>Loading...</span>
  </div>
)}
```

For buttons:
```typescript
<Button disabled={isSubmitting}>
  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  Submit
</Button>
```

### Error Handling

Use toast notifications for user feedback:

```typescript
import { toast } from 'sonner'

// Success
toast.success('Workspace created', {
  description: 'Your workspace is now ready to use',
})

// Error
toast.error('Failed to create workspace', {
  description: error instanceof Error ? error.message : 'An unexpected error occurred',
})

// Info
toast.info('Processing', {
  description: 'This may take a few moments',
})
```

### Empty States

Provide helpful empty states:

```typescript
{items.length === 0 && (
  <Card>
    <CardHeader>
      <CardTitle>No Items</CardTitle>
      <CardDescription>
        Get started by creating your first item
      </CardDescription>
    </CardHeader>
  </Card>
)}
```

## Data Fetching

### Client Components

Client components use the gRPC client for data fetching:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { workspaceClient } from '@/lib/grpc/workspace-client'

export function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const data = await workspaceClient.listWorkspaces()
        setWorkspaces(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Render logic
}
```

### Server Components

Server components can fetch data directly:

```typescript
import { workspaceClient } from '@/lib/grpc/workspace-client'

export default async function WorkspacePage({ params }: { params: { id: string } }) {
  const workspace = await workspaceClient.getWorkspace(params.id)

  return <WorkspaceDetails workspace={workspace} />
}
```

## Styling Conventions

### Utility Classes

Use Tailwind utility classes for styling:

- **Spacing**: `p-4`, `m-2`, `space-y-4`, `gap-2`
- **Layout**: `flex`, `grid`, `grid-cols-3`, `items-center`
- **Typography**: `text-sm`, `font-medium`, `text-muted-foreground`
- **Colors**: Use CSS variables: `bg-background`, `text-foreground`, `border-border`
- **Responsive**: `md:grid-cols-2`, `lg:p-6`

### Custom Utilities

Use the `cn()` utility for conditional classes:

```typescript
import { cn } from '@/lib/utils'

<div className={cn(
  'base-class',
  isActive && 'active-class',
  variant === 'primary' && 'primary-class'
)} />
```

## Accessibility

### Keyboard Navigation
- All interactive elements are keyboard accessible
- Use proper focus indicators
- Support tab, enter, escape keys

### Screen Readers
- Use semantic HTML elements
- Provide aria-labels for icons
- Use proper heading hierarchy

### Color Contrast
- All text meets WCAG AA contrast ratios
- Don't rely solely on color for information

## File Organization

```
orbit-www/
  src/
    app/                          # Next.js App Router pages
      (frontend)/
        workspaces/
          page.tsx                # Workspace list page
      globals.css                 # Global styles with Tailwind
    components/
      features/                   # Feature-specific components
        workspace/
          WorkspaceManager.tsx    # Main components
      ui/                         # shadcn/ui components (generated)
        button.tsx
        card.tsx
    lib/
      grpc/                       # gRPC client implementations
        workspace-client.ts
      utils.ts                    # Utility functions (cn, etc.)
```

## Best Practices

1. **Always use TypeScript**: Define proper types and interfaces
2. **Validate user input**: Use Zod schemas for all forms
3. **Handle errors gracefully**: Show user-friendly error messages
4. **Provide feedback**: Use loading states and toast notifications
5. **Mobile-first**: Design for mobile, enhance for desktop
6. **Component composition**: Break complex components into smaller pieces
7. **Separation of concerns**: Keep UI, business logic, and data fetching separate
8. **Consistent naming**: Use clear, descriptive names for components and props
9. **Documentation**: Add comments for complex logic
10. **Reusability**: Create reusable patterns when you use something 3+ times

## Future Enhancements

- [ ] Add dark mode toggle component
- [ ] Implement form field auto-save
- [ ] Add skeleton loaders for better perceived performance
- [ ] Create data table component with advanced features
- [ ] Add animation variants for smoother transitions
- [ ] Implement virtual scrolling for large lists
