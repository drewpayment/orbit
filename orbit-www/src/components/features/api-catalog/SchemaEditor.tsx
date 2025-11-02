'use client';

import React from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, AlertCircle } from 'lucide-react';
import { apiCatalogClient, type SchemaType } from '@/lib/grpc/api-catalog-client';
import { validateSchema, type ValidationResult } from '@/lib/schema-validators';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

interface SchemaEditorProps {
  workspaceId: string;
  schemaType?: SchemaType;
  initialContent?: string;
  schemaName?: string;
  onSave?: (data: { schemaContent: string; schemaType: SchemaType; name?: string }) => void;
}

const SCHEMA_TYPE_LANGUAGES: Record<SchemaType, string> = {
  protobuf: 'protobuf',
  openapi: 'yaml',
  graphql: 'graphql',
};

const SCHEMA_TYPE_TEMPLATES: Record<SchemaType, string> = {
  protobuf: `syntax = "proto3";

package example;

service ExampleService {
  rpc GetExample(GetExampleRequest) returns (GetExampleResponse);
}

message GetExampleRequest {
  string id = 1;
}

message GetExampleResponse {
  string id = 1;
  string name = 2;
}`,
  openapi: `openapi: 3.0.0
info:
  title: Example API
  version: 1.0.0
  description: An example API specification

paths:
  /example:
    get:
      summary: Get example
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string`,
  graphql: `type Query {
  example(id: ID!): Example
}

type Example {
  id: ID!
  name: String!
  description: String
  createdAt: String!
}

type Mutation {
  createExample(input: CreateExampleInput!): Example
}

input CreateExampleInput {
  name: String!
  description: String
}`,
};

export function SchemaEditor({
  workspaceId,
  schemaType: initialSchemaType = 'protobuf',
  initialContent,
  schemaName,
  onSave,
}: SchemaEditorProps) {
  const [schemaType, setSchemaType] = React.useState<SchemaType>(initialSchemaType);
  const [content, setContent] = React.useState<string>(
    initialContent || SCHEMA_TYPE_TEMPLATES[initialSchemaType]
  );
  const [validation, setValidation] = React.useState<ValidationResult>({ valid: true, errors: [] });
  const [isSaving, setIsSaving] = React.useState(false);

  // Validate on content or schema type change
  React.useEffect(() => {
    const result = validateSchema(content, schemaType);
    setValidation(result);
  }, [content, schemaType]);

  // Update template when schema type changes
  React.useEffect(() => {
    if (!initialContent) {
      setContent(SCHEMA_TYPE_TEMPLATES[schemaType]);
    }
  }, [schemaType, initialContent]);

  const handleSchemaTypeChange = (value: SchemaType) => {
    setSchemaType(value);
  };

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '');
  };

  const handleSave = async () => {
    if (!validation.valid) {
      toast.error('Please fix validation errors before saving');
      return;
    }

    setIsSaving(true);
    try {
      await apiCatalogClient.saveSchema({
        workspaceId,
        schemaType,
        schemaContent: content,
        name: schemaName,
      });

      toast.success('Schema saved successfully');

      if (onSave) {
        onSave({
          schemaContent: content,
          schemaType,
          name: schemaName,
        });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="schema-editor">
      <Card>
        <CardHeader>
          <CardTitle>Schema Editor</CardTitle>
          <CardDescription>
            Create and edit API schemas with syntax validation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Schema Type Selector */}
          <div className="space-y-2">
            <Label htmlFor="schema-type">Schema Type</Label>
            <Select value={schemaType} onValueChange={handleSchemaTypeChange}>
              <SelectTrigger id="schema-type" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="protobuf">Protocol Buffers</SelectItem>
                <SelectItem value="openapi">OpenAPI</SelectItem>
                <SelectItem value="graphql">GraphQL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Monaco Editor */}
          <div className="border rounded-md overflow-hidden">
            <Editor
              height="500px"
              language={SCHEMA_TYPE_LANGUAGES[schemaType]}
              value={content}
              onChange={handleEditorChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
              }}
              data-testid="monaco-editor"
            />
          </div>

          {/* Validation Errors */}
          {!validation.valid && validation.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-2">Validation Error</div>
                <ul className="list-disc list-inside space-y-1">
                  {validation.errors.map((error, index) => (
                    <li key={index} className="text-sm">
                      {error.line && `Line ${error.line}: `}
                      {error.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={handleSave}
              disabled={!validation.valid || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Schema
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
