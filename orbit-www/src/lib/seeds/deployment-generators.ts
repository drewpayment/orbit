export const builtInGenerators = [
  {
    name: 'Docker Compose (Basic)',
    slug: 'docker-compose-basic',
    description: 'Generate a docker-compose.yml for local or remote Docker deployment',
    type: 'docker-compose' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['serviceName'],
      properties: {
        serviceName: {
          type: 'string',
          description: 'Service name in the compose file',
        },
        port: {
          type: 'number',
          description: 'Port to expose (default: 3000)',
          default: 3000,
        },
      },
    },
    templateFiles: [
      {
        path: 'docker-compose.yml',
        content: `services:
  {{.ServiceName}}:
    image: {{.ImageRepo}}:{{.ImageTag}}
    ports:
      - "{{.Port}}:{{.Port}}"
    restart: unless-stopped{{if .EnvVars}}
    environment:{{range .EnvVars}}
      {{.Key}}: ""  # Set this value from your environment{{end}}{{end}}{{if .HealthCheckURL}}
    healthcheck:
      test: ["CMD", "curl", "-f", "{{.HealthCheckURL}}"]
      interval: 30s
      timeout: 10s
      retries: 3{{end}}
`,
      },
    ],
  },
]
