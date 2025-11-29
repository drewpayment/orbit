export const builtInGenerators = [
  {
    name: 'Docker Compose (Basic)',
    slug: 'docker-compose-basic',
    description: 'Deploy to a Docker host using docker-compose',
    type: 'docker-compose' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['hostUrl', 'serviceName'],
      properties: {
        hostUrl: {
          type: 'string',
          description: 'Docker host URL (e.g., ssh://user@host or unix:///var/run/docker.sock)',
        },
        serviceName: {
          type: 'string',
          description: 'Service name for the deployment',
        },
        imageTag: {
          type: 'string',
          description: 'Docker image tag to deploy',
          default: 'latest',
        },
        port: {
          type: 'number',
          description: 'Port to expose',
          default: 3000,
        },
        envVars: {
          type: 'object',
          description: 'Environment variables',
          additionalProperties: { type: 'string' },
        },
      },
    },
    templateFiles: [
      {
        path: 'docker-compose.yml',
        content: `version: '3.8'

services:
  {{serviceName}}:
    image: {{imageRepository}}:{{imageTag}}
    ports:
      - "{{port}}:{{port}}"
    environment:
{{#each envVars}}
      {{@key}}: "{{this}}"
{{/each}}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:{{port}}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
`,
      },
    ],
  },
]
