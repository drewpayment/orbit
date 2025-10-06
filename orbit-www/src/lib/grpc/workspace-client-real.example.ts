/**
 * Real TypeScript gRPC client for Workspace Service using generated Connect-ES code
 *
 * This is an example implementation showing how to use the generated proto clients.
 * Once your backend services are running, replace workspace-client.ts with this pattern.
 */

import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { WorkspaceService } from '@/lib/proto/workspace_connect'
import type {
  Workspace,
  WorkspaceMember,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  ListWorkspacesRequest,
  AddMemberRequest,
  UpdateMemberRoleRequest,
} from '@/lib/proto/workspace_pb'
import { WorkspaceRole } from '@/lib/proto/workspace_pb'

/**
 * Create the gRPC transport
 */
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
  // Add interceptors for auth, logging, etc.
  // interceptors: [authInterceptor, loggingInterceptor],
})

/**
 * Create the typed client
 */
const client = createPromiseClient(WorkspaceService, transport)

/**
 * Workspace Service Client
 */
export class WorkspaceClient {
  async createWorkspace(input: {
    name: string
    slug: string
    description?: string
    settings: {
      default_visibility: 'private' | 'internal' | 'public'
      require_approval_for_repos: boolean
      enable_code_generation: boolean
      allowed_template_types?: string[]
    }
  }): Promise<Workspace> {
    const response = await client.createWorkspace({
      name: input.name,
      slug: input.slug,
      description: input.description,
      settings: {
        defaultVisibility: this.mapVisibility(input.settings.default_visibility),
        requireApprovalForRepos: input.settings.require_approval_for_repos,
        enableCodeGeneration: input.settings.enable_code_generation,
        allowedTemplateTypes: input.settings.allowed_template_types || [],
        integrationSettings: undefined,
      },
    })

    if (!response.workspace) {
      throw new Error('Failed to create workspace')
    }

    return response.workspace
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await client.listWorkspaces({
      pagination: {
        page: 1,
        pageSize: 100,
      },
      filters: [],
      sort: [],
    })

    return response.workspaces
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const response = await client.getWorkspace({ id })
    return response.workspace || null
  }

  async updateWorkspace(input: {
    id: string
    name?: string
    description?: string
    settings?: {
      default_visibility?: 'private' | 'internal' | 'public'
      require_approval_for_repos?: boolean
      enable_code_generation?: boolean
    }
  }): Promise<Workspace> {
    const response = await client.updateWorkspace({
      id: input.id,
      name: input.name,
      description: input.description,
      settings: input.settings
        ? {
            defaultVisibility: input.settings.default_visibility
              ? this.mapVisibility(input.settings.default_visibility)
              : undefined,
            requireApprovalForRepos: input.settings.require_approval_for_repos,
            enableCodeGeneration: input.settings.enable_code_generation,
            allowedTemplateTypes: [],
            integrationSettings: undefined,
          }
        : undefined,
    })

    if (!response.workspace) {
      throw new Error('Failed to update workspace')
    }

    return response.workspace
  }

  async deleteWorkspace(id: string): Promise<void> {
    await client.deleteWorkspace({ id })
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const response = await client.listMembers({
      workspaceId,
      pagination: {
        page: 1,
        pageSize: 100,
      },
      filters: [],
    })

    return response.members
  }

  async addMember(input: {
    workspace_id: string
    user_email: string
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }): Promise<WorkspaceMember> {
    const response = await client.addMember({
      workspaceId: input.workspace_id,
      userEmail: input.user_email,
      role: this.mapRole(input.role),
      permissions: [],
    })

    if (!response.member) {
      throw new Error('Failed to add member')
    }

    return response.member
  }

  async updateMemberRole(input: {
    workspace_id: string
    user_id: string
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }): Promise<WorkspaceMember> {
    const response = await client.updateMemberRole({
      workspaceId: input.workspace_id,
      userId: input.user_id,
      role: this.mapRole(input.role),
      permissions: [],
    })

    if (!response.member) {
      throw new Error('Failed to update member role')
    }

    return response.member
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await client.removeMember({
      workspaceId,
      userId,
    })
  }

  // Helper methods to map between UI types and protobuf enums
  private mapVisibility(visibility: 'private' | 'internal' | 'public'): number {
    const map = {
      private: 1, // VISIBILITY_PRIVATE
      internal: 2, // VISIBILITY_INTERNAL
      public: 3, // VISIBILITY_PUBLIC
    }
    return map[visibility]
  }

  private mapRole(role: 'owner' | 'admin' | 'member' | 'viewer'): WorkspaceRole {
    const map = {
      viewer: WorkspaceRole.WORKSPACE_ROLE_VIEWER,
      member: WorkspaceRole.WORKSPACE_ROLE_MEMBER,
      admin: WorkspaceRole.WORKSPACE_ROLE_ADMIN,
      owner: WorkspaceRole.WORKSPACE_ROLE_OWNER,
    }
    return map[role]
  }
}

// Singleton instance
export const workspaceClient = new WorkspaceClient()

/**
 * Usage example:
 *
 * import { workspaceClient } from '@/lib/grpc/workspace-client-real.example'
 *
 * const workspaces = await workspaceClient.listWorkspaces()
 * const newWorkspace = await workspaceClient.createWorkspace({
 *   name: 'Engineering',
 *   slug: 'engineering',
 *   description: 'Engineering team workspace',
 *   settings: {
 *     default_visibility: 'internal',
 *     require_approval_for_repos: true,
 *     enable_code_generation: true,
 *   }
 * })
 */
