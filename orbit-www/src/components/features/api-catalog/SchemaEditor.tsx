'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, AlertCircle } from 'lucide-react';
import { apiCatalogClient, SchemaType } from '@/lib/grpc/api-catalog-client';
import { validateSchema, type ValidationResult } from '@/lib/schema-validators';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

// Dynamically import Monaco Editor to reduce initial bundle size (~2MB)
const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading editor...</span>
      </div>
    </div>
  ),
});

interface SchemaEditorProps {
  workspaceId: string;
  schemaType?: SchemaType;
  initialContent?: string;
  schemaName?: string;
  onSave?: (data: { schemaContent: string; schemaType: SchemaType; name?: string }) => void;
}

const SCHEMA_TYPE_LANGUAGES: Partial<Record<SchemaType, string>> = {
  [SchemaType.PROTOBUF]: 'protobuf',
  [SchemaType.OPENAPI]: 'yaml',
  [SchemaType.GRAPHQL]: 'graphql',
};

const SCHEMA_TYPE_TEMPLATES: Partial<Record<SchemaType, string>> = {
  [SchemaType.PROTOBUF]: `syntax = "proto3";

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
  [SchemaType.OPENAPI]: `openapi: 3.0.0
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
  [SchemaType.GRAPHQL]: `type Query {
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
  schemaType: initialSchemaType = SchemaType.PROTOBUF,
  initialContent,
  schemaName,
  onSave,
}: SchemaEditorProps) {
  const [schemaType, setSchemaType] = React.useState<SchemaType>(initialSchemaType);
  const [content, setContent] = React.useState<string>(
    initialContent || SCHEMA_TYPE_TEMPLATES[initialSchemaType] || ''
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
      setContent(SCHEMA_TYPE_TEMPLATES[schemaType] || '');
    }
  }, [schemaType, initialContent]);

  const handleSchemaTypeChange = (value: string) => {
    setSchemaType(Number(value) as SchemaType);
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
      await apiCatalogClient.createSchema({
        workspaceId,
        schemaType,
        rawContent: content,
        name: schemaName || '',
        slug: '',
        version: '1.0.0',
        description: '',
        tags: [],
        license: '',
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
    <div
      className="space-y-4"
      data-testid="schema-editor"
      role="region"
      aria-label="API Schema Editor"
    >
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
            <Select value={String(schemaType)} onValueChange={handleSchemaTypeChange}>
              <SelectTrigger
                id="schema-type"
                className="w-[200px]"
                aria-label="Select schema type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(SchemaType.PROTOBUF)}>Protocol Buffers</SelectItem>
                <SelectItem value={String(SchemaType.OPENAPI)}>OpenAPI</SelectItem>
                <SelectItem value={String(SchemaType.GRAPHQL)}>GraphQL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Monaco Editor */}
          <div
            className="border rounded-md overflow-hidden"
            role="region"
            aria-label={`${schemaType} schema code editor`}
            aria-describedby={!validation.valid ? 'schema-validation-errors' : undefined}
          >
            <Editor
              height="500px"
              language={SCHEMA_TYPE_LANGUAGES[schemaType] || 'text'}
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
            <Alert
              id="schema-validation-errors"
              variant="destructive"
              role="alert"
              aria-live="assertive"
            >
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
