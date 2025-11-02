# SOP: Error Handling

**Created**: 2025-01-15
**Last Updated**: 2025-01-15
**Trigger**: When implementing error handling in Go services or frontend code

## Purpose
Establish consistent error handling patterns across Go microservices and TypeScript frontend to ensure proper error propagation, logging, and user experience.

## Constitutional Requirements

**MANDATORY FOR DEBUGGING:**

1. **systematic-debugging** (REQUIRED):
   - Use `superpowers:systematic-debugging` for ANY bug or error investigation
   - Four-phase framework: root cause → pattern analysis → hypothesis testing → implementation
   - NO GUESSING at fixes without understanding root cause

2. **test-driven-development** (REQUIRED):
   - Write error scenario tests FIRST, watch them FAIL
   - Then implement error handling to make tests pass
   - Constitutional requirement for all code

## Prerequisites
- **Constitutional**: Use `superpowers:systematic-debugging` for error investigation
- Understanding of Go error handling
- Familiarity with gRPC status codes
- Knowledge of TypeScript error types
- Commitment to TDD for error scenarios

## Go Service Error Handling

### Domain Layer Errors

#### Define Domain-Specific Errors
`internal/domain/errors.go`:

```go
package domain

import "errors"

// Sentinel errors for business logic violations
var (
    ErrNotFound           = errors.New("entity not found")
    ErrAlreadyExists      = errors.New("entity already exists")
    ErrInvalidInput       = errors.New("invalid input")
    ErrInvalidWorkspaceID = errors.New("invalid workspace ID")
    ErrUnauthorized       = errors.New("unauthorized")
    ErrForbidden          = errors.New("forbidden")
)
```

#### Custom Error Types with Context
```go
package domain

import "fmt"

// ValidationError provides detailed validation failure information
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed for %s: %s", e.Field, e.Message)
}

// NewValidationError creates a new validation error
func NewValidationError(field, message string) *ValidationError {
    return &ValidationError{
        Field:   field,
        Message: message,
    }
}
```

#### Domain Entity Validation
```go
package domain

func (w *Workspace) Validate() error {
    if w.Name == "" {
        return NewValidationError("name", "name is required")
    }
    if len(w.Name) > 100 {
        return NewValidationError("name", "name must be 100 characters or less")
    }
    if w.Slug == "" {
        return NewValidationError("slug", "slug is required")
    }
    // Slug validation regex
    if !isValidSlug(w.Slug) {
        return NewValidationError("slug", "slug must contain only lowercase letters, numbers, and hyphens")
    }
    return nil
}
```

### Service Layer Error Handling

#### Wrap Errors with Context
```go
package service

import (
    "context"
    "fmt"

    "github.com/drewpayment/orbit/services/workspace/internal/domain"
)

func (s *WorkspaceService) GetWorkspace(ctx context.Context, id string) (*domain.Workspace, error) {
    workspace, err := s.repo.FindByID(ctx, id)
    if err != nil {
        // Wrap repository error with context
        return nil, fmt.Errorf("failed to get workspace %s: %w", id, err)
    }

    if workspace == nil {
        return nil, domain.ErrNotFound
    }

    return workspace, nil
}
```

#### Error Checking Patterns
```go
// Check for specific error types
if errors.Is(err, domain.ErrNotFound) {
    return nil, domain.ErrNotFound
}

// Check for error interfaces
var validationErr *domain.ValidationError
if errors.As(err, &validationErr) {
    return nil, fmt.Errorf("validation failed: %w", validationErr)
}
```

### gRPC Layer Error Conversion

#### Convert Domain Errors to gRPC Status Codes
`internal/grpc/errors.go`:

```go
package grpc

import (
    "errors"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"

    "github.com/drewpayment/orbit/services/workspace/internal/domain"
)

// convertDomainError converts domain errors to gRPC status errors
func convertDomainError(err error) error {
    if err == nil {
        return nil
    }

    // Check for domain sentinel errors
    switch {
    case errors.Is(err, domain.ErrNotFound):
        return status.Error(codes.NotFound, "resource not found")
    case errors.Is(err, domain.ErrAlreadyExists):
        return status.Error(codes.AlreadyExists, "resource already exists")
    case errors.Is(err, domain.ErrUnauthorized):
        return status.Error(codes.Unauthenticated, "authentication required")
    case errors.Is(err, domain.ErrForbidden):
        return status.Error(codes.PermissionDenied, "permission denied")
    }

    // Check for validation errors
    var validationErr *domain.ValidationError
    if errors.As(err, &validationErr) {
        return status.Errorf(codes.InvalidArgument, "validation failed: %s", validationErr.Message)
    }

    // Default to internal error (don't leak implementation details)
    return status.Error(codes.Internal, "internal server error")
}
```

#### Use in gRPC Handlers
```go
package grpc

import (
    "context"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"

    pb "github.com/drewpayment/orbit/proto/gen/go/workspace"
)

func (s *Server) GetWorkspace(
    ctx context.Context,
    req *pb.GetWorkspaceRequest,
) (*pb.GetWorkspaceResponse, error) {
    // Validate request
    if req.Id == "" {
        return nil, status.Error(codes.InvalidArgument, "id is required")
    }

    // Call service layer
    workspace, err := s.service.GetWorkspace(ctx, req.Id)
    if err != nil {
        // Convert domain error to gRPC error
        return nil, convertDomainError(err)
    }

    return &pb.GetWorkspaceResponse{
        Workspace: domainToProto(workspace),
    }, nil
}
```

### Logging Best Practices

#### Structured Logging
```go
package service

import (
    "log/slog"
    "os"
)

var logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

func (s *WorkspaceService) CreateWorkspace(ctx context.Context, name, slug string) (*domain.Workspace, error) {
    logger.Info("creating workspace",
        slog.String("name", name),
        slog.String("slug", slug),
    )

    workspace, err := s.repo.Create(ctx, name, slug)
    if err != nil {
        logger.Error("failed to create workspace",
            slog.String("name", name),
            slog.String("slug", slug),
            slog.String("error", err.Error()),
        )
        return nil, fmt.Errorf("failed to create workspace: %w", err)
    }

    logger.Info("workspace created successfully",
        slog.String("id", workspace.ID),
        slog.String("slug", workspace.Slug),
    )

    return workspace, nil
}
```

#### Don't Log Sensitive Data
```go
// ❌ BAD: Logging passwords or tokens
logger.Error("authentication failed", slog.String("password", password))

// ✅ GOOD: Log non-sensitive context
logger.Error("authentication failed", slog.String("user_id", userID))
```

## Frontend Error Handling

### Handling gRPC Errors in TypeScript

#### Error Type Checking
```typescript
import { ConnectError, Code } from '@connectrpc/connect';

async function createWorkspace(name: string, slug: string) {
  try {
    const response = await workspaceClient.createWorkspace({
      name,
      slug,
    });
    return response.workspace;
  } catch (error) {
    if (error instanceof ConnectError) {
      switch (error.code) {
        case Code.InvalidArgument:
          throw new Error(`Invalid input: ${error.message}`);
        case Code.AlreadyExists:
          throw new Error('A workspace with this slug already exists');
        case Code.NotFound:
          throw new Error('Workspace not found');
        case Code.Unauthenticated:
          // Redirect to login
          window.location.href = '/login';
          return;
        case Code.PermissionDenied:
          throw new Error('You do not have permission to perform this action');
        case Code.Internal:
        default:
          throw new Error('An unexpected error occurred. Please try again.');
      }
    }
    // Non-gRPC error (network issue, etc.)
    throw new Error('Failed to connect to server. Please check your connection.');
  }
}
```

#### Error Utility Function
`orbit-www/src/lib/errors.ts`:

```typescript
import { ConnectError, Code } from '@connectrpc/connect';

export function getErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.InvalidArgument:
        return `Invalid input: ${error.message}`;
      case Code.AlreadyExists:
        return 'This resource already exists';
      case Code.NotFound:
        return 'Resource not found';
      case Code.Unauthenticated:
        return 'Please log in to continue';
      case Code.PermissionDenied:
        return 'You do not have permission for this action';
      case Code.Internal:
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ConnectError &&
         (error.code === Code.Unauthenticated || error.code === Code.PermissionDenied);
}
```

### React Error Boundaries

#### Component-Level Error Boundary
```typescript
'use client';

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 border border-red-500 rounded">
          <h2 className="text-red-500 font-bold">Something went wrong</h2>
          <p className="text-gray-600">{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### User-Facing Error Messages

#### Toast Notifications
```typescript
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

async function handleCreateWorkspace(name: string, slug: string) {
  try {
    const workspace = await createWorkspace(name, slug);
    toast.success('Workspace created successfully');
    return workspace;
  } catch (error) {
    toast.error(getErrorMessage(error));
    throw error;
  }
}
```

#### Form Validation Errors
```typescript
import { useState } from 'react';
import { getErrorMessage } from '@/lib/errors';

export function WorkspaceForm() {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      await createWorkspace(name, slug);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      {/* Form fields */}
    </form>
  );
}
```

## Testing Error Scenarios

### Go Unit Tests
```go
func TestCreateWorkspace_ValidationError(t *testing.T) {
    svc := service.NewWorkspaceService(mockRepo)

    tests := []struct {
        name    string
        wsName  string
        slug    string
        wantErr error
    }{
        {
            name:    "empty name",
            wsName:  "",
            slug:    "test",
            wantErr: domain.ErrInvalidInput,
        },
        {
            name:    "invalid slug",
            wsName:  "Test",
            slug:    "Invalid Slug!",
            wantErr: domain.ErrInvalidInput,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            _, err := svc.CreateWorkspace(context.Background(), tt.wsName, tt.slug)
            assert.ErrorIs(t, err, tt.wantErr)
        })
    }
}
```

### Frontend Tests
```typescript
import { describe, it, expect, vi } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import { getErrorMessage } from '@/lib/errors';

describe('Error Handling', () => {
  it('converts gRPC not found error', () => {
    const error = new ConnectError('not found', Code.NotFound);
    expect(getErrorMessage(error)).toBe('Resource not found');
  });

  it('converts gRPC invalid argument error', () => {
    const error = new ConnectError('invalid slug', Code.InvalidArgument);
    expect(getErrorMessage(error)).toContain('Invalid input');
  });

  it('handles unknown errors', () => {
    const error = new Error('Something went wrong');
    expect(getErrorMessage(error)).toBe('Something went wrong');
  });
});
```

## Common Mistakes to Avoid

1. ❌ **Exposing internal errors to users** - Always convert to user-friendly messages
2. ❌ **Using panic in service code** - Return errors instead
3. ❌ **Ignoring errors** - Always handle or propagate errors
4. ❌ **Logging passwords or tokens** - Never log sensitive data
5. ❌ **Generic error messages** - Provide actionable error messages
6. ❌ **Not wrapping errors** - Use `fmt.Errorf("context: %w", err)` to preserve error chain
7. ❌ **Returning `codes.Unknown`** - Always map to appropriate gRPC code

## Error Handling Checklist

**Constitutional Requirements:**
- [ ] Used `superpowers:systematic-debugging` for error investigation
- [ ] Wrote error scenario tests FIRST (TDD)
- [ ] Watched tests FAIL before implementing error handling
- [ ] Run `superpowers:verification-before-completion` before claiming fixes work

**Implementation:**
- [ ] Domain errors defined as sentinel errors
- [ ] Validation errors provide field-level details
- [ ] Service layer wraps errors with context
- [ ] gRPC layer converts domain errors to status codes
- [ ] Sensitive data never logged
- [ ] Frontend handles all gRPC error codes
- [ ] User-facing error messages are clear and actionable
- [ ] Error scenarios covered in tests

## Related Documentation
- See: [../system/api-architecture.md](../system/api-architecture.md) for gRPC error patterns
- See: [adding-grpc-services.md](adding-grpc-services.md) for service implementation
- See: [testing-workflow.md](testing-workflow.md) for error testing patterns
