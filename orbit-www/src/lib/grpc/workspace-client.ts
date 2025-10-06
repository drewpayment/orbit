/**
 * TypeScript gRPC client for Workspace Service
 *
 * This is a placeholder implementation until proto generation is complete.
 * Once `make proto-gen` runs, this will be replaced with generated Connect-ES clients
 * from orbit-www/src/lib/proto/
 */

export interface CreateWorkspaceInput {
  name: string
  slug: string
  description?: string
  settings: {
    default_visibility: 'private' | 'internal' | 'public'
    require_approval_for_repos: boolean
    enable_code_generation: boolean
    allowed_template_types?: string[]
  }
}

export interface UpdateWorkspaceInput {
  id: string
  name?: string
  description?: string
  settings?: {
    default_visibility?: 'private' | 'internal' | 'public'
    require_approval_for_repos?: boolean
    enable_code_generation?: boolean
  }
}

export interface Workspace {
  id: string
  name: string
  slug: string
  description?: string
  settings: {
    default_visibility: 'private' | 'internal' | 'public'
    require_approval_for_repos: boolean
    enable_code_generation: boolean
    allowed_template_types: string[]
  }
  created_at: Date
  updated_at: Date
  created_by: string
  memberCount?: number
  repositoryCount?: number
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  user_email: string
  user_name: string
  user_avatar?: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joined_at: Date
}

export interface AddMemberInput {
  workspace_id: string
  user_email: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface UpdateMemberRoleInput {
  workspace_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

/**
 * Workspace Service Client
 *
 * TODO: Replace with generated Connect-ES client from proto definitions
 * After running `make proto-gen`, import the generated client:
 *
 * import { createPromiseClient } from "@connectrpc/connect"
 * import { createConnectTransport } from "@connectrpc/connect-web"
 * import { WorkspaceService } from "@/lib/proto/workspace_connect"
 */
export class WorkspaceClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    // TODO: Replace with actual gRPC call
    console.log('Creating workspace:', input)

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      id: `ws-${Date.now()}`,
      name: input.name,
      slug: input.slug,
      description: input.description,
      settings: input.settings,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: 'current-user-id',
      memberCount: 1,
      repositoryCount: 0,
    }
  }

  async listWorkspaces(): Promise<Workspace[]> {
    // TODO: Replace with actual gRPC call
    console.log('Listing workspaces')

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 800))

    return [
      {
        id: '1',
        name: 'Engineering',
        slug: 'engineering',
        description: 'Main engineering workspace for product development',
        settings: {
          default_visibility: 'internal',
          require_approval_for_repos: true,
          enable_code_generation: true,
          allowed_template_types: ['service', 'library', 'frontend'],
        },
        created_at: new Date('2024-01-15'),
        updated_at: new Date('2024-03-20'),
        created_by: 'user-1',
        memberCount: 12,
        repositoryCount: 45,
      },
      {
        id: '2',
        name: 'Platform',
        slug: 'platform',
        description: 'Infrastructure and platform services',
        settings: {
          default_visibility: 'private',
          require_approval_for_repos: true,
          enable_code_generation: true,
          allowed_template_types: ['service', 'library'],
        },
        created_at: new Date('2024-02-01'),
        updated_at: new Date('2024-03-22'),
        created_by: 'user-2',
        memberCount: 8,
        repositoryCount: 23,
      },
    ]
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    // TODO: Replace with actual gRPC call
    console.log('Getting workspace:', id)

    const workspaces = await this.listWorkspaces()
    return workspaces.find(w => w.id === id) || null
  }

  async updateWorkspace(input: UpdateWorkspaceInput): Promise<Workspace> {
    // TODO: Replace with actual gRPC call
    console.log('Updating workspace:', input)

    await new Promise(resolve => setTimeout(resolve, 1000))

    const workspace = await this.getWorkspace(input.id)
    if (!workspace) {
      throw new Error('Workspace not found')
    }

    return {
      ...workspace,
      ...input,
      settings: input.settings ? { ...workspace.settings, ...input.settings } : workspace.settings,
      updated_at: new Date(),
    }
  }

  async deleteWorkspace(id: string): Promise<void> {
    // TODO: Replace with actual gRPC call
    console.log('Deleting workspace:', id)

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    // TODO: Replace with actual gRPC call
    console.log('Listing members for workspace:', workspaceId)

    await new Promise(resolve => setTimeout(resolve, 800))

    return [
      {
        workspace_id: workspaceId,
        user_id: 'user-1',
        user_email: 'alice@example.com',
        user_name: 'Alice Johnson',
        role: 'owner',
        joined_at: new Date('2024-01-15'),
      },
      {
        workspace_id: workspaceId,
        user_id: 'user-2',
        user_email: 'bob@example.com',
        user_name: 'Bob Smith',
        role: 'admin',
        joined_at: new Date('2024-02-01'),
      },
    ]
  }

  async addMember(input: AddMemberInput): Promise<WorkspaceMember> {
    // TODO: Replace with actual gRPC call
    console.log('Adding member:', input)

    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      workspace_id: input.workspace_id,
      user_id: `user-${Date.now()}`,
      user_email: input.user_email,
      user_name: input.user_email.split('@')[0],
      role: input.role,
      joined_at: new Date(),
    }
  }

  async updateMemberRole(input: UpdateMemberRoleInput): Promise<WorkspaceMember> {
    // TODO: Replace with actual gRPC call
    console.log('Updating member role:', input)

    await new Promise(resolve => setTimeout(resolve, 500))

    const members = await this.listMembers(input.workspace_id)
    const member = members.find(m => m.user_id === input.user_id)

    if (!member) {
      throw new Error('Member not found')
    }

    return {
      ...member,
      role: input.role,
    }
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    // TODO: Replace with actual gRPC call
    console.log('Removing member:', { workspaceId, userId })

    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

// Singleton instance
export const workspaceClient = new WorkspaceClient()
