// Temporary mock implementation until proto import issues are resolved
// TODO: Replace with actual Connect-ES client once proto imports are fixed

export type SchemaType = 'protobuf' | 'openapi' | 'graphql';

interface Schema {
  id: string;
  workspaceId: string;
  name: string;
  schemaType: SchemaType;
  content: string;
  version: string;
}

interface SaveSchemaRequest {
  workspaceId: string;
  name?: string;
  schemaType: SchemaType;
  schemaContent: string;
}

interface SaveSchemaResponse {
  schemaId: string;
  version: string;
}

class ApiCatalogClient {
  async saveSchema(req: SaveSchemaRequest): Promise<SaveSchemaResponse> {
    // Mock implementation - replace with actual gRPC call
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
      schemaId: `schema-${Date.now()}`,
      version: '1.0.0',
    };
  }
}

export const apiCatalogClient = new ApiCatalogClient();
