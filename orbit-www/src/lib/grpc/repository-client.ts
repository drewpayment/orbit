// Temporary mock implementation until proto import issues are resolved
// TODO: Replace with actual Connect-ES client once proto imports are fixed

interface Repository {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: string;
  templateType?: string;
  gitUrl?: string;
}

interface CreateRepositoryRequest {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: string;
  templateType: string;
  gitUrl?: string;
}

interface CreateRepositoryResponse {
  repository: Repository;
}

class RepositoryClient {
  async createRepository(req: CreateRepositoryRequest): Promise<CreateRepositoryResponse> {
    // Mock implementation - replace with actual gRPC call
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
      repository: {
        id: `repo-${Date.now()}`,
        name: req.name,
        slug: req.slug,
        description: req.description,
        visibility: req.visibility,
        templateType: req.templateType,
        gitUrl: req.gitUrl,
      }
    };
  }
}

export const repositoryClient = new RepositoryClient();
