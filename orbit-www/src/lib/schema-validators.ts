import { parse as parseGraphQL, GraphQLError } from 'graphql';
import { SchemaType } from '@/lib/proto/api_catalog_pb';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  line?: number;
  column?: number;
  message: string;
}

/**
 * Validates protobuf schema syntax
 */
export function validateProtobuf(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!content.trim()) {
    return { valid: true, errors: [] };
  }

  // Basic protobuf syntax validation
  // Check for syntax declaration
  const syntaxMatch = content.match(/syntax\s*=\s*"(proto2|proto3)"\s*;/);
  if (!syntaxMatch) {
    errors.push({
      line: 1,
      message: 'Missing or invalid syntax declaration. Expected: syntax = "proto3";'
    });
  }

  // Check for common syntax errors
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
      return;
    }

    // Check for missing semicolons on certain statements
    if ((trimmedLine.startsWith('syntax') ||
         trimmedLine.startsWith('package') ||
         trimmedLine.startsWith('import') ||
         trimmedLine.match(/^\s*\w+\s+\w+\s*=\s*\d+/)) && // field declarations
        !trimmedLine.endsWith(';') &&
        !trimmedLine.endsWith('{') &&
        !trimmedLine.endsWith('}')) {
      errors.push({
        line: index + 1,
        message: 'Missing semicolon'
      });
    }

    // Check for invalid syntax patterns
    if (trimmedLine.match(/syntax\s*=\s*"(?!proto2|proto3)/)) {
      errors.push({
        line: index + 1,
        message: 'Invalid syntax version. Must be "proto2" or "proto3"'
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates OpenAPI schema syntax (basic JSON/YAML validation)
 */
export function validateOpenAPI(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!content.trim()) {
    return { valid: true, errors: [] };
  }

  try {
    // Try parsing as JSON
    if (content.trim().startsWith('{')) {
      const parsed = JSON.parse(content);

      // Check for required OpenAPI fields
      if (!parsed.openapi && !parsed.swagger) {
        errors.push({
          line: 1,
          message: 'Missing OpenAPI version field (openapi or swagger)'
        });
      }

      if (!parsed.info) {
        errors.push({
          line: 1,
          message: 'Missing required "info" field'
        });
      }

      if (!parsed.paths) {
        errors.push({
          line: 1,
          message: 'Missing required "paths" field'
        });
      }
    } else {
      // Basic YAML validation
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        // Check for basic YAML syntax
        if (line.trim() && !line.match(/^[#\s]/) && !line.match(/^[\w-]+:/)) {
          const indent = line.match(/^\s*/)?.[0].length || 0;
          if (indent % 2 !== 0) {
            errors.push({
              line: index + 1,
              message: 'Invalid YAML indentation (must be multiples of 2)'
            });
          }
        }
      });
    }
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : 'Invalid JSON syntax'
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates AsyncAPI schema syntax (basic JSON/YAML validation)
 */
export function validateAsyncAPI(content: string): ValidationResult {
  const errors: ValidationError[] = []
  if (!content.trim()) {
    return { valid: false, errors: [{ message: 'Content is empty' }] }
  }
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(content)
  } catch {
    const lines = content.split('\n')
    const hasAsyncapi = lines.some((l) => l.trim().startsWith('asyncapi:'))
    const hasInfo = lines.some((l) => l.trim().startsWith('info:'))
    const hasChannels = lines.some((l) => l.trim().startsWith('channels:'))
    if (!hasAsyncapi) errors.push({ message: 'Missing "asyncapi" field. Expected an AsyncAPI specification.' })
    if (!hasInfo) errors.push({ message: 'Missing "info" section.' })
    if (!hasChannels) errors.push({ message: 'Missing "channels" section.' })
    return { valid: errors.length === 0, errors }
  }
  if (parsed) {
    if (!parsed.asyncapi) errors.push({ message: 'Missing "asyncapi" field. Expected an AsyncAPI specification.' })
    if (!parsed.info) errors.push({ message: 'Missing "info" section.' })
    if (!parsed.channels) errors.push({ message: 'Missing "channels" section.' })
  }
  return { valid: errors.length === 0, errors }
}

/**
 * Validates schema content based on a string schema type identifier
 */
export function validateSchemaByType(content: string, schemaType: string): ValidationResult {
  switch (schemaType) {
    case 'openapi':
      return validateOpenAPI(content)
    case 'asyncapi':
      return validateAsyncAPI(content)
    case 'graphql':
      return validateGraphQL(content)
    case 'protobuf':
      return validateProtobuf(content)
    default:
      return { valid: true, errors: [] }
  }
}

/**
 * Validates GraphQL schema syntax using the `graphql` package's parser.
 */
export function validateGraphQL(content: string): ValidationResult {
  if (!content.trim()) {
    return { valid: true, errors: [] };
  }

  try {
    parseGraphQL(content);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof GraphQLError) {
      const location = error.locations?.[0];
      return {
        valid: false,
        errors: [
          {
            line: location?.line,
            column: location?.column,
            message: error.message,
          },
        ],
      };
    }
    return {
      valid: false,
      errors: [{ message: error instanceof Error ? error.message : 'Invalid GraphQL syntax' }],
    };
  }
}

/**
 * Validates schema based on type
 */
export function validateSchema(content: string, schemaType: SchemaType): ValidationResult {
  switch (schemaType) {
    case SchemaType.PROTOBUF:
      return validateProtobuf(content);
    case SchemaType.OPENAPI:
      return validateOpenAPI(content);
    case SchemaType.GRAPHQL:
      return validateGraphQL(content);
    default:
      return { valid: true, errors: [] };
  }
}
