// Temporary mock implementation until proto import issues are resolved
// TODO: Replace with actual Connect-ES client once proto imports are fixed

interface KnowledgePage {
  id: string;
  title: string;
  slug: string;
  spaceId: string;
  parentId?: string | null;
  sortOrder: number;
  status: 'draft' | 'published' | 'archived';
  content: any;
}

interface ReorderPagesRequest {
  spaceId: string;
  pageOrders: Array<{
    pageId: string;
    sortOrder: number;
    parentId?: string | null;
  }>;
}

interface ReorderPagesResponse {
  success: boolean;
}

interface GetSpacePagesRequest {
  spaceId: string;
}

interface GetSpacePagesResponse {
  pages: KnowledgePage[];
}

class KnowledgeClient {
  async getSpacePages(req: GetSpacePagesRequest): Promise<GetSpacePagesResponse> {
    // Mock implementation - replace with actual gRPC call
    await new Promise(resolve => setTimeout(resolve, 300));

    return {
      pages: [],
    };
  }

  async reorderPages(req: ReorderPagesRequest): Promise<ReorderPagesResponse> {
    // Mock implementation - replace with actual gRPC call
    await new Promise(resolve => setTimeout(resolve, 300));

    return {
      success: true,
    };
  }
}

export const knowledgeClient = new KnowledgeClient();
