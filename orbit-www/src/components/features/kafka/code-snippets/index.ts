export type CodeSnippetParams = {
  bootstrapServers: string
  topicName: string
  username: string
  authMethod: string
  tlsEnabled: boolean
}

export { generateJavaSnippet } from './java-template'
export { generatePythonSnippet } from './python-template'
export { generateNodejsSnippet } from './nodejs-template'
export { generateGoSnippet } from './go-template'
