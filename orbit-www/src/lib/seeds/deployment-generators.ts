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
      {{.Key}}: \${{{.Key}}}{{end}}{{end}}{{if .HealthCheckURL}}
    healthcheck:
      test: ["CMD", "curl", "-f", "{{.HealthCheckURL}}"]
      interval: 30s
      timeout: 10s
      retries: 3{{end}}
`,
      },
    ],
  },
  {
    name: 'Helm Chart (Basic)',
    slug: 'helm-basic',
    description: 'Generate a Helm chart for Kubernetes deployment',
    type: 'helm' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['releaseName'],
      properties: {
        releaseName: {
          type: 'string',
          description: 'Helm release name',
        },
        namespace: {
          type: 'string',
          description: 'Kubernetes namespace (default: default)',
          default: 'default',
        },
        replicas: {
          type: 'number',
          description: 'Number of replicas (default: 1)',
          default: 1,
        },
        port: {
          type: 'number',
          description: 'Container port (default: 3000)',
          default: 3000,
        },
      },
    },
    templateFiles: [
      {
        path: 'Chart.yaml',
        content: `apiVersion: v2
name: {{.ServiceName}}
description: Helm chart for {{.ServiceName}}
type: application
version: 0.1.0
appVersion: "{{.ImageTag}}"
`,
      },
      {
        path: 'values.yaml',
        content: `replicaCount: {{.Replicas}}

image:
  repository: {{.ImageRepo}}
  tag: "{{.ImageTag}}"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: {{.Port}}

resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
{{if .EnvVars}}
env:{{range .EnvVars}}
  {{.Key}}: ""  # Set via --set or values override{{end}}
{{end}}`,
      },
      {
        path: 'templates/deployment.yaml',
        content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{"{{"}} include "chart.fullname" . {{"}}"}}
  labels:
    app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
spec:
  replicas: {{"{{"}} .Values.replicaCount {{"}}"}}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
    spec:
      containers:
        - name: {{"{{"}} .Chart.Name {{"}}"}}
          image: "{{"{{"}} .Values.image.repository {{"}}"}}:{{"{{"}} .Values.image.tag {{"}}"}}"
          ports:
            - containerPort: {{"{{"}} .Values.service.port {{"}}"}}
{{- if .EnvVars}}
          env:{{range .EnvVars}}
            - name: {{.Key}}
              valueFrom:
                secretKeyRef:
                  name: {{"{{"}} include "chart.fullname" . {{"}}"}}-secrets
                  key: {{.Key}}{{end}}
{{- end}}
          resources:
            {{"{{"}}- toYaml .Values.resources | nindent 12 {{"}}"}}
`,
      },
      {
        path: 'templates/service.yaml',
        content: `apiVersion: v1
kind: Service
metadata:
  name: {{"{{"}} include "chart.fullname" . {{"}}"}}
spec:
  type: {{"{{"}} .Values.service.type {{"}}"}}
  ports:
    - port: {{"{{"}} .Values.service.port {{"}}"}}
      targetPort: {{"{{"}} .Values.service.port {{"}}"}}
      protocol: TCP
  selector:
    app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
`,
      },
      {
        path: 'templates/_helpers.tpl',
        content: `{{"{{"}}- define "chart.name" -{{"}}"}}
{{"{{"}}- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- end {{"}}"}}

{{"{{"}}- define "chart.fullname" -{{"}}"}}
{{"{{"}}- if .Values.fullnameOverride {{"}}"}}
{{"{{"}}- .Values.fullnameOverride | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- else {{"}}"}}
{{"{{"}}- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- end {{"}}"}}
{{"{{"}}- end {{"}}"}}
`,
      },
    ],
  },
]
