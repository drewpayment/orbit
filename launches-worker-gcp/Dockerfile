FROM node:20-slim
WORKDIR /app

# Install Pulumi CLI
RUN apt-get update && apt-get install -y curl git && \
    curl -fsSL https://get.pulumi.com | sh && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.pulumi/bin:${PATH}"

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && \
    find src/templates -name 'Pulumi.yaml' | while read f; do \
      dest="dist/${f#src/}"; \
      mkdir -p "$(dirname "$dest")"; \
      cp "$f" "$dest"; \
    done
CMD ["node", "dist/worker.js"]
