import { SchemaType } from './grpc/api-catalog-client';

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
 * Validates GraphQL schema syntax
 */
export function validateGraphQL(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!content.trim()) {
    return { valid: true, errors: [] };
  }

  // Basic GraphQL syntax validation
  const lines = content.split('\n');
  let inBlockComment = false;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    // Handle block comments
    if (trimmedLine.includes('"""')) {
      inBlockComment = !inBlockComment;
      return;
    }
    if (inBlockComment || trimmedLine.startsWith('#')) {
      return;
    }

    // Check for valid GraphQL type definitions
    if (trimmedLine && !trimmedLine.match(/^(type|interface|union|enum|input|scalar|schema|extend|directive|query|mutation|subscription)\s/)) {
      // Check if it's part of a type definition (fields, etc.)
      if (!trimmedLine.match(/^\w+(\(.*\))?:\s*[\w\[\]!]+/) &&
          !trimmedLine.endsWith('{') &&
          !trimmedLine.endsWith('}') &&
          trimmedLine.length > 0) {
        // This might be an error, but let's be lenient for now
      }
    }

    // Check for unclosed braces
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    if (openBraces > 1 || closeBraces > 1) {
      errors.push({
        line: index + 1,
        message: 'Multiple braces on single line'
      });
    }
  });

  if (inBlockComment) {
    errors.push({
      message: 'Unclosed block comment'
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
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
