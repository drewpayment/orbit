/**
 * Environment Variable Parser
 *
 * Parses .env file format into key-value pairs.
 * Supports:
 * - Standard format: KEY=value
 * - Quoted values: KEY="value with spaces" or KEY='value'
 * - Comments: # ignored
 * - Empty lines: ignored
 * - Export prefix: export KEY=value (strips `export`)
 * - Multiline values with quotes
 */

export interface ParsedEnvVariable {
  name: string
  value: string
  line?: number
}

export interface ParseResult {
  variables: ParsedEnvVariable[]
  errors: Array<{ line: number; message: string }>
}

/**
 * Parse .env file content into environment variables
 */
export function parseEnvFile(content: string): ParseResult {
  const variables: ParsedEnvVariable[] = []
  const errors: Array<{ line: number; message: string }> = []

  const lines = content.split(/\r?\n/)
  let lineNumber = 0

  while (lineNumber < lines.length) {
    const line = lines[lineNumber]
    const trimmedLine = line.trim()
    lineNumber++

    // Skip empty lines
    if (trimmedLine === '') {
      continue
    }

    // Skip comments
    if (trimmedLine.startsWith('#')) {
      continue
    }

    // Try to parse the line
    const result = parseLine(trimmedLine, lineNumber)

    if (result.error) {
      errors.push({ line: lineNumber, message: result.error })
    } else if (result.variable) {
      variables.push(result.variable)
    }
  }

  return { variables, errors }
}

interface LineParseResult {
  variable?: ParsedEnvVariable
  error?: string
}

function parseLine(line: string, lineNumber: number): LineParseResult {
  // Remove 'export ' prefix if present
  let workingLine = line
  if (workingLine.startsWith('export ')) {
    workingLine = workingLine.slice(7)
  }

  // Find the = sign
  const equalsIndex = workingLine.indexOf('=')
  if (equalsIndex === -1) {
    return { error: 'Missing = sign' }
  }

  // Extract key
  const key = workingLine.slice(0, equalsIndex).trim()

  // Validate key
  if (!isValidEnvName(key)) {
    return { error: `Invalid variable name: ${key}` }
  }

  // Extract value
  let value = workingLine.slice(equalsIndex + 1)

  // Handle quoted values
  value = parseValue(value)

  return {
    variable: {
      name: key,
      value,
      line: lineNumber,
    },
  }
}

/**
 * Parse a value, handling quotes
 */
function parseValue(rawValue: string): string {
  let value = rawValue.trim()

  // Check for double quotes
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
    // Handle escape sequences in double-quoted strings
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  // Check for single quotes
  else if (value.startsWith("'") && value.endsWith("'")) {
    // Single quotes are literal - no escape processing
    value = value.slice(1, -1)
  }
  // Unquoted value - trim trailing comments
  else {
    // Remove inline comments (but be careful with # in values)
    const commentIndex = value.indexOf(' #')
    if (commentIndex > 0) {
      value = value.slice(0, commentIndex).trim()
    }
  }

  return value
}

/**
 * Validate environment variable name
 * Must start with letter or underscore, contain only letters, numbers, underscores
 */
function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/**
 * Convert parsed variables back to .env format
 */
export function toEnvFormat(variables: Array<{ name: string; value: string }>): string {
  return variables
    .map(({ name, value }) => {
      // Quote value if it contains special characters
      const needsQuotes =
        value.includes(' ') ||
        value.includes('\n') ||
        value.includes('\r') ||
        value.includes('\t') ||
        value.includes('"') ||
        value.includes("'") ||
        value.includes('#')

      if (needsQuotes) {
        // Use double quotes and escape special chars
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
        return `${name}="${escaped}"`
      }

      return `${name}=${value}`
    })
    .join('\n')
}

/**
 * Validate a single environment variable name
 */
export function validateEnvName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'Name is required' }
  }

  if (name.length > 255) {
    return { valid: false, error: 'Name must be 255 characters or less' }
  }

  if (!isValidEnvName(name)) {
    return {
      valid: false,
      error: 'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
    }
  }

  return { valid: true }
}
