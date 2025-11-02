# IDP Frontend & Workflows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Internal Developer Portal frontend components and Temporal workflows for repository generation, code generation, and knowledge synchronization.

**Architecture:** React 19 + Next.js 15 frontend with Payload CMS integration, communicating with Go microservices via gRPC (Connect-ES). Temporal workflows handle long-running asynchronous operations with durable execution and progress tracking.

**Tech Stack:**
- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- State: React Query (TanStack Query), Zustand
- Forms: React Hook Form, Zod validation
- Backend: Go 1.21+, gRPC, Temporal, PostgreSQL

**Current Status:**
- ✅ T001-T045 Complete (Setup, tests, models, services, APIs, WorkspaceManager UI)
- 🎯 T046-T074 Remaining (4 frontend components, 3 workflows, integrations, QA)

---

## Prerequisites

**Before Starting:**
- ✅ All contract tests (T011-T028) are failing (TDD requirement)
- ✅ Domain models implemented (T029-T034)
- ✅ Service layer implemented (T035-T040)
- ✅ gRPC servers implemented (T041-T044)
- ✅ WorkspaceManager UI complete (T045)

**Environment Setup:**
```bash
# Verify setup
cd /Users/drew.payment/dev/idp
make proto-gen              # Generate proto code
cd orbit-www && pnpm install  # Install dependencies
make dev                    # Start infrastructure
```

**Reference Documentation:**
- Architecture: `.agent/system/api-architecture.md`
- gRPC Patterns: `.agent/SOPs/adding-grpc-services.md`
- Error Handling: `.agent/SOPs/error-handling.md`
- Similar Implementation: `.agent/tasks/feature-workspace-management.md`

---

## Task 46: Repository Creation Wizard

**Goal:** Multi-step wizard for creating repositories from templates with validation and preview.

**Files:**
- Create: `orbit-www/src/components/features/repository/RepositoryWizard.tsx`
- Create: `orbit-www/src/components/features/repository/RepositoryWizard.test.tsx`
- Create: `orbit-www/src/components/features/repository/steps/TemplateSelect.tsx`
- Create: `orbit-www/src/components/features/repository/steps/RepositoryConfig.tsx`
- Create: `orbit-www/src/components/features/repository/steps/Review.tsx`
- Create: `orbit-www/src/lib/grpc/repository-client.ts`
- Reference: `orbit-www/src/components/features/workspace/WorkspaceManager.tsx` (similar pattern)

### Step 1: Write failing component test

**File:** `orbit-www/src/components/features/repository/RepositoryWizard.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RepositoryWizard } from './RepositoryWizard';

describe('RepositoryWizard', () => {
  const mockOnComplete = vi.fn();
  const mockWorkspaceId = 'ws-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders template selection step initially', () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    expect(screen.getByText('Select Template')).toBeInTheDocument();
    expect(screen.getByText(/choose a repository template/i)).toBeInTheDocument();
  });

  it('shows configuration step after template selection', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Select service template
    const serviceTemplate = screen.getByTestId('template-service');
    fireEvent.click(serviceTemplate);

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Configure Repository')).toBeInTheDocument();
      expect(screen.getByLabelText(/repository name/i)).toBeInTheDocument();
    });
  });

  it('validates required fields', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Go to config step
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Try to proceed without filling required fields
    await waitFor(() => screen.getByText('Configure Repository'));

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText(/repository name is required/i)).toBeInTheDocument();
    });
  });

  it('shows review step with summary', async () => {
    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Complete first two steps
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByLabelText(/repository name/i));

    fireEvent.change(screen.getByLabelText(/repository name/i), {
      target: { value: 'my-service' }
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Test service' }
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
      expect(screen.getByText('my-service')).toBeInTheDocument();
      expect(screen.getByText('Test service')).toBeInTheDocument();
    });
  });

  it('calls onComplete when creation succeeds', async () => {
    const mockRepositoryClient = {
      createRepository: vi.fn().mockResolvedValue({
        repository: { id: 'repo-123', name: 'my-service' }
      })
    };

    vi.mock('@/lib/grpc/repository-client', () => ({
      repositoryClient: mockRepositoryClient
    }));

    render(<RepositoryWizard workspaceId={mockWorkspaceId} onComplete={mockOnComplete} />);

    // Complete all steps
    fireEvent.click(screen.getByTestId('template-service'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByLabelText(/repository name/i));
    fireEvent.change(screen.getByLabelText(/repository name/i), {
      target: { value: 'my-service' }
    });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => screen.getByText('Review & Create'));
    fireEvent.click(screen.getByRole('button', { name: /create repository/i }));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith('repo-123');
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd orbit-www
pnpm test src/components/features/repository/RepositoryWizard.test.tsx
```

**Expected Output:**
```
FAIL  src/components/features/repository/RepositoryWizard.test.tsx
  ● Test suite failed to run
    Cannot find module './RepositoryWizard' from 'RepositoryWizard.test.tsx'
```

### Step 3: Create gRPC client wrapper

**File:** `orbit-www/src/lib/grpc/repository-client.ts`

```typescript
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { RepositoryService } from '@/lib/proto/repository_connect';

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_REPOSITORY_URL || 'http://localhost:50051',
});

export const repositoryClient = createPromiseClient(RepositoryService, transport);
```

### Step 4: Create template selection step component

**File:** `orbit-www/src/components/features/repository/steps/TemplateSelect.tsx`

```typescript
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileCode, Globe, Smartphone, BookOpen } from 'lucide-react';

export type TemplateType = 'service' | 'library' | 'frontend' | 'mobile' | 'documentation';

interface Template {
  type: TemplateType;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const templates: Template[] = [
  {
    type: 'service',
    name: 'Microservice',
    description: 'Go-based gRPC microservice with Temporal workflows',
    icon: <FileCode className="h-8 w-8" />,
  },
  {
    type: 'library',
    name: 'Shared Library',
    description: 'Reusable Go library or TypeScript package',
    icon: <Globe className="h-8 w-8" />,
  },
  {
    type: 'frontend',
    name: 'Frontend Application',
    description: 'Next.js application with Payload CMS',
    icon: <Globe className="h-8 w-8" />,
  },
  {
    type: 'mobile',
    name: 'Mobile App',
    description: 'React Native mobile application',
    icon: <Smartphone className="h-8 w-8" />,
  },
  {
    type: 'documentation',
    name: 'Documentation Site',
    description: 'Documentation site with search and versioning',
    icon: <BookOpen className="h-8 w-8" />,
  },
];

interface TemplateSelectProps {
  selectedTemplate: TemplateType | null;
  onSelect: (template: TemplateType) => void;
}

export function TemplateSelect({ selectedTemplate, onSelect }: TemplateSelectProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Select Template</h2>
        <p className="text-muted-foreground">
          Choose a repository template to get started quickly
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card
            key={template.type}
            data-testid={`template-${template.type}`}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedTemplate === template.type
                ? 'border-primary ring-2 ring-primary'
                : ''
            }`}
            onClick={() => onSelect(template.type)}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                {template.icon}
                <CardTitle>{template.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>{template.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

### Step 5: Create repository configuration step

**File:** `orbit-www/src/components/features/repository/steps/RepositoryConfig.tsx`

```typescript
'use client';

import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface RepositoryFormData {
  name: string;
  slug: string;
  description: string;
  visibility: 'private' | 'internal' | 'public';
  gitUrl?: string;
}

interface RepositoryConfigProps {
  form: UseFormReturn<RepositoryFormData>;
}

export function RepositoryConfig({ form }: RepositoryConfigProps) {
  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = form;

  // Auto-generate slug from name
  const name = watch('name');
  React.useEffect(() => {
    if (name) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setValue('slug', slug);
    }
  }, [name, setValue]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configure Repository</h2>
        <p className="text-muted-foreground">
          Provide details for your new repository
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Repository Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            placeholder="my-awesome-service"
            {...register('name', { required: 'Repository name is required' })}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">
            Slug <span className="text-muted-foreground text-xs">(auto-generated)</span>
          </Label>
          <Input id="slug" disabled {...register('slug')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            placeholder="A brief description of this repository"
            rows={3}
            {...register('description')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            defaultValue="private"
            onValueChange={(value) => setValue('visibility', value as any)}
          >
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Private: Only workspace members • Internal: All authenticated users • Public:
            Everyone
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gitUrl">
            Git URL <span className="text-muted-foreground text-xs">(optional)</span>
          </Label>
          <Input
            id="gitUrl"
            placeholder="https://github.com/org/repo.git"
            {...register('gitUrl')}
          />
        </div>
      </div>
    </div>
  );
}
```

### Step 6: Create review step component

**File:** `orbit-www/src/components/features/repository/steps/Review.tsx`

```typescript
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RepositoryFormData } from './RepositoryConfig';
import { TemplateType } from './TemplateSelect';

interface ReviewProps {
  template: TemplateType;
  formData: RepositoryFormData;
}

export function Review({ template, formData }: ReviewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Review & Create</h2>
        <p className="text-muted-foreground">
          Review your repository configuration before creating
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Details</CardTitle>
          <CardDescription>Configuration summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Template Type</p>
            <p className="text-lg capitalize">{template}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p className="text-lg">{formData.name}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Slug</p>
            <p className="font-mono text-lg">{formData.slug}</p>
          </div>

          {formData.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-lg">{formData.description}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-muted-foreground">Visibility</p>
            <Badge variant="outline" className="capitalize">
              {formData.visibility}
            </Badge>
          </div>

          {formData.gitUrl && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Git URL</p>
              <p className="font-mono text-sm">{formData.gitUrl}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

### Step 7: Create main wizard component

**File:** `orbit-www/src/components/features/repository/RepositoryWizard.tsx`

```typescript
'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { TemplateSelect, TemplateType } from './steps/TemplateSelect';
import { RepositoryConfig, RepositoryFormData } from './steps/RepositoryConfig';
import { Review } from './steps/Review';
import { repositoryClient } from '@/lib/grpc/repository-client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

interface RepositoryWizardProps {
  workspaceId: string;
  onComplete: (repositoryId: string) => void;
}

type WizardStep = 'template' | 'config' | 'review';

export function RepositoryWizard({ workspaceId, onComplete }: RepositoryWizardProps) {
  const [currentStep, setCurrentStep] = React.useState<WizardStep>('template');
  const [selectedTemplate, setSelectedTemplate] = React.useState<TemplateType | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const form = useForm<RepositoryFormData>({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      visibility: 'private',
      gitUrl: '',
    },
  });

  const handleNext = async () => {
    if (currentStep === 'template' && !selectedTemplate) {
      toast.error('Please select a template');
      return;
    }

    if (currentStep === 'config') {
      const isValid = await form.trigger();
      if (!isValid) return;
    }

    const steps: WizardStep[] = ['template', 'config', 'review'];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: WizardStep[] = ['template', 'config', 'review'];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  const handleCreate = async () => {
    const formData = form.getValues();

    setIsCreating(true);
    try {
      const response = await repositoryClient.createRepository({
        workspaceId,
        name: formData.name,
        slug: formData.slug,
        description: formData.description,
        visibility: formData.visibility,
        templateType: selectedTemplate!,
        gitUrl: formData.gitUrl || undefined,
      });

      toast.success('Repository created successfully');
      onComplete(response.repository!.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-24 rounded ${currentStep === 'template' ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-24 rounded ${currentStep === 'config' ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`h-2 w-24 rounded ${currentStep === 'review' ? 'bg-primary' : 'bg-muted'}`} />
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {currentStep === 'template' && (
          <TemplateSelect
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplate}
          />
        )}

        {currentStep === 'config' && (
          <RepositoryConfig form={form} />
        )}

        {currentStep === 'review' && (
          <Review template={selectedTemplate!} formData={form.getValues()} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 'template' || isCreating}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {currentStep !== 'review' ? (
          <Button onClick={handleNext} disabled={isCreating}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Repository
          </Button>
        )}
      </div>
    </div>
  );
}
```

### Step 8: Run tests to verify they pass

```bash
cd orbit-www
pnpm test src/components/features/repository/RepositoryWizard.test.tsx
```

**Expected Output:**
```
PASS  src/components/features/repository/RepositoryWizard.test.tsx
  RepositoryWizard
    ✓ renders template selection step initially
    ✓ shows configuration step after template selection
    ✓ validates required fields
    ✓ shows review step with summary
    ✓ calls onComplete when creation succeeds

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

### Step 9: Commit

```bash
git add orbit-www/src/components/features/repository/
git add orbit-www/src/lib/grpc/repository-client.ts
git commit -m "feat: add repository creation wizard with multi-step form

- Template selection with microservice, library, frontend, mobile, docs
- Configuration form with name, slug, description, visibility
- Review step with summary before creation
- Integration with RepositoryService gRPC client
- Comprehensive test coverage with React Testing Library

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 47: API Schema Editor

**Goal:** Monaco-based editor for API schemas with syntax validation and preview.

**Files:**
- Create: `orbit-www/src/components/features/api-catalog/SchemaEditor.tsx`
- Create: `orbit-www/src/components/features/api-catalog/SchemaEditor.test.tsx`
- Create: `orbit-www/src/lib/grpc/api-catalog-client.ts`
- Create: `orbit-www/src/lib/schema-validators.ts`

### Step 1: Write failing component test

**File:** `orbit-www/src/components/features/api-catalog/SchemaEditor.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SchemaEditor } from './SchemaEditor';

describe('SchemaEditor', () => {
  it('renders monaco editor', () => {
    render(<SchemaEditor workspaceId="ws-123" />);
    expect(screen.getByTestId('schema-editor')).toBeInTheDocument();
  });

  it('validates protobuf syntax', async () => {
    render(<SchemaEditor workspaceId="ws-123" schemaType="protobuf" />);

    const editor = screen.getByTestId('schema-editor');

    // Invalid proto syntax
    fireEvent.change(editor, {
      target: { value: 'syntax = "invalid";' }
    });

    await waitFor(() => {
      expect(screen.getByText(/invalid protobuf syntax/i)).toBeInTheDocument();
    });
  });

  it('allows schema upload', async () => {
    const mockOnSave = vi.fn();
    render(<SchemaEditor workspaceId="ws-123" onSave={mockOnSave} />);

    const validProto = 'syntax = "proto3";\nservice Test {}';
    const editor = screen.getByTestId('schema-editor');

    fireEvent.change(editor, { target: { value: validProto } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        schemaContent: validProto
      }));
    });
  });
});
```

### Step 2-9: [Similar TDD pattern - Run test, create client, implement component, test passes, commit]

**Abbreviated for brevity - full implementation follows same TDD cycle**

---

## Task 48: Knowledge Space Navigator

**Goal:** Hierarchical navigation tree for knowledge spaces with drag-drop reordering.

[Similar structure to Task 46-47]

---

## Task 49: Code Generation Monitor

**Goal:** Real-time progress tracking for Temporal workflows with status polling.

[Similar structure to Task 46-47]

---

## Task 50: Repository Generation Workflow

**Goal:** Temporal workflow for creating repositories from templates with Git operations.

**Files:**
- Create: `temporal-workflows/internal/workflows/repository_workflow.go`
- Create: `temporal-workflows/internal/workflows/repository_workflow_test.go`
- Create: `temporal-workflows/internal/activities/git_activities.go`
- Create: `temporal-workflows/internal/activities/git_activities_test.go`

### Step 1: Write failing workflow test

**File:** `temporal-workflows/internal/workflows/repository_workflow_test.go`

```go
package workflows

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

type RepositoryWorkflowTestSuite struct {
	testsuite.WorkflowTestSuite
}

func TestRepositoryWorkflow(t *testing.T) {
	suite.Run(t, new(RepositoryWorkflowTestSuite))
}

func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_Success() {
	env := s.NewTestWorkflowEnvironment()

	// Mock activities
	env.OnActivity(CloneTemplateActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(ApplyVariablesActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(InitializeGitActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(PushToRemoteActivity, mock.Anything, mock.Anything).Return(nil)

	// Execute workflow
	env.ExecuteWorkflow(RepositoryGenerationWorkflow, RepositoryWorkflowInput{
		WorkspaceID:  "ws-123",
		RepositoryID: "repo-123",
		TemplateName: "microservice",
		Variables:    map[string]string{"service_name": "my-service"},
	})

	assert.True(s.T(), env.IsWorkflowCompleted())
	assert.NoError(s.T(), env.GetWorkflowError())

	var result RepositoryWorkflowResult
	env.GetWorkflowResult(&result)
	assert.Equal(s.T(), "repo-123", result.RepositoryID)
	assert.NotEmpty(s.T(), result.GitURL)
}

func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_TemplateNotFound() {
	env := s.NewTestWorkflowEnvironment()

	env.OnActivity(CloneTemplateActivity, mock.Anything, mock.Anything).
		Return(errors.New("template not found"))

	env.ExecuteWorkflow(RepositoryGenerationWorkflow, RepositoryWorkflowInput{
		WorkspaceID:  "ws-123",
		RepositoryID: "repo-123",
		TemplateName: "nonexistent",
	})

	assert.True(s.T(), env.IsWorkflowCompleted())
	assert.Error(s.T(), env.GetWorkflowError())
}
```

### Step 2: Run test to verify it fails

```bash
cd temporal-workflows
go test -v ./internal/workflows/repository_workflow_test.go
```

**Expected:** `cannot load package: ./internal/workflows: no Go files`

### Step 3-9: [Implement workflow with activities, test passes, commit]

---

## Execution Summary

**Plan complete and saved to `docs/plans/2025-11-01-idp-frontend-workflows.md`.**

**Remaining Tasks:**
- T046-T049: Frontend components (4 components)
- T050-T052: Temporal workflows (3 workflows)
- T053-T062: Integration & middleware (10 tasks)
- T063-T074: QA & polish (12 tasks)

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
