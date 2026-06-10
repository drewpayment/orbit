# orbit-agent-sandbox
#
# The container image used by the Infrastructure Agent's K8s SandboxExecutor.
# Each agent run runs inside a fresh pod built from this image, with the
# workspace's cloud creds projected via ExternalSecret and an egress
# NetworkPolicy enforcing the workspace allowlist.
#
# Tooling is intentionally broad: the agent picks the right CLI for the job
# at runtime, so anything plausibly useful for "deploy this app to a cloud"
# belongs here. Adding a tool requires no Go code change — it just becomes
# usable via the shell_exec tool.
#
# Build (from repo root):
#   docker build -t orbit-agent-sandbox:latest infrastructure/agent-sandbox
#
# Push to the local Orbit registry:
#   docker tag orbit-agent-sandbox:latest localhost:5050/orbit-agent-sandbox:latest
#   docker push localhost:5050/orbit-agent-sandbox:latest

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG TARGETARCH

# Tool versions. Pin every binary download so reproducibility is preserved
# across builds; bumping is a deliberate edit.
ARG KUBECTL_VERSION=v1.31.1
ARG HELM_VERSION=v3.16.2
ARG TERRAFORM_VERSION=1.9.8
ARG PULUMI_VERSION=3.135.1
ARG NODE_MAJOR=20

# Base packages: shell tools, build essentials for native modules, Python,
# Node, JDK (Maven/Gradle), Git, and the dependencies of the cloud SDKs we
# install below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        curl \
        ca-certificates \
        git \
        gnupg \
        jq \
        less \
        lsb-release \
        make \
        openssh-client \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        sudo \
        unzip \
        wget \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/*

# --- Node.js (NodeSource) ---
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- kubectl ---
RUN ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

# --- Helm ---
RUN ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${ARCH}.tar.gz" -o /tmp/helm.tgz \
    && tar -xzf /tmp/helm.tgz -C /tmp \
    && mv /tmp/linux-${ARCH}/helm /usr/local/bin/helm \
    && chmod +x /usr/local/bin/helm \
    && rm -rf /tmp/helm.tgz /tmp/linux-${ARCH}

# --- Terraform ---
RUN ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip" -o /tmp/terraform.zip \
    && unzip -q /tmp/terraform.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/terraform \
    && rm /tmp/terraform.zip

# --- Pulumi ---
RUN ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/') \
    && curl -fsSL "https://get.pulumi.com/releases/sdk/pulumi-v${PULUMI_VERSION}-linux-${ARCH}.tar.gz" -o /tmp/pulumi.tgz \
    && tar -xzf /tmp/pulumi.tgz -C /usr/local/lib \
    && ln -s /usr/local/lib/pulumi/pulumi /usr/local/bin/pulumi \
    && rm /tmp/pulumi.tgz

# --- AWS CLI v2 ---
RUN ARCH=$(uname -m) \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws

# --- Azure CLI ---
RUN curl -sLS https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/microsoft.gpg \
    && echo "deb [arch=amd64,arm64] https://packages.microsoft.com/repos/azure-cli/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/azure-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends azure-cli \
    && rm -rf /var/lib/apt/lists/*

# --- Google Cloud SDK ---
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin \
    && rm -rf /var/lib/apt/lists/*

# --- Non-root user ---
# The agent runs as `agent` (UID 1000); workspaces and writable paths are
# under /home/agent. Cloud creds projected via ExternalSecret land at
# /home/agent/.config (mounted) and standard env vars.
RUN useradd -ms /bin/bash --uid 1000 agent
USER agent
WORKDIR /home/agent

# Pre-create the directory the agent's working files live in so volume
# mounts don't have to.
RUN mkdir -p /home/agent/workspace /home/agent/.config

# Default command keeps the pod alive until the workflow tears it down.
# Activities exec their commands via `kubectl exec` rather than as the pod's
# entrypoint.
CMD ["sleep", "infinity"]
