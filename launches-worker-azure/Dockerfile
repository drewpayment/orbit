FROM node:20-slim

# Install Pulumi CLI system-wide so it is available for the non-root user.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://get.pulumi.com | sh -s -- --install-root /usr/local \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create a non-root user and give it ownership of the work directory.
# Pulumi stores state under PULUMI_HOME (defaults to ~/.pulumi); we pin it to
# /app/.pulumi so the path is predictable and stays within /app.
RUN groupadd --gid 10001 orbit \
    && useradd --uid 10001 --gid orbit --shell /bin/sh --no-create-home orbit \
    && chown -R orbit:orbit /app

COPY --chown=orbit:orbit package*.json ./
RUN npm ci
COPY --chown=orbit:orbit . .
RUN npm run build

ENV PULUMI_HOME=/app/.pulumi

USER orbit

CMD ["node", "dist/worker.js"]
