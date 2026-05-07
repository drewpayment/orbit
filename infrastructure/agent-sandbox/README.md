# orbit-agent-sandbox

Container image and Kubernetes manifests for the per-run sandbox the
Infrastructure Agent uses to execute commands.

The image lives at `infrastructure/agent-sandbox/Dockerfile` and bundles
`bash`, `python3`, `node`, `kubectl`, `helm`, `terraform`, `pulumi`,
`aws-cli`, `azure-cli`, and `gcloud` so the LLM can pick the right CLI for
the deployment without engineering boilerplate per cloud.

## Build & push

```bash
# Build for your local docker daemon.
docker build -t orbit-agent-sandbox:latest infrastructure/agent-sandbox

# Push to the local Orbit registry exposed by docker-compose at :5050.
docker tag orbit-agent-sandbox:latest localhost:5050/orbit-agent-sandbox:latest
docker push localhost:5050/orbit-agent-sandbox:latest
```

## Kubernetes deployment

Manifests in `infrastructure/k8s/agent-sandbox/`:

- `namespace.yaml` — `orbit-agent-sandbox` namespace; per-run pods land here.
- `rbac.yaml` — `ServiceAccount`/`Role`/`RoleBinding` granting the temporal
  worker the minimum permissions needed to create / exec / delete sandbox
  pods on behalf of agent runs.
- `networkpolicy-template.yaml` — egress allowlist template the worker
  renders per agent run with the workspace's hosts.
- `pod-template.yaml` — sandbox pod template the K8s SandboxExecutor
  instantiates per run; cloud creds are projected via the workspace's
  ExternalSecret reference.

The K8s SandboxExecutor itself ships in a follow-up commit; the local
subprocess executor is the production path until then and is sufficient for
`make dev` and CI.

## Adding a tool

1. Add its installation to `Dockerfile` (preferably with a pinned version arg).
2. Rebuild and push the image; bump the image tag in `pod-template.yaml`.
3. The agent can use the new tool immediately via `shell_exec` — no Go,
   gRPC, or workflow code change required.
