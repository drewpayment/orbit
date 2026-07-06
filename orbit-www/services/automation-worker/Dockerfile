# Temporal worker for Orbit scheduled automations (P4.2).
#
# Self-contained image: the @orbit/automation-worker package only imports
# @temporalio/* and its own relative modules (no orbit-www imports), so it builds
# standalone — mirroring services/launches-worker-azure. The Temporal worker
# bundles the workflow code from src/workflows at startup, so the .ts source ships
# in the image and runs via tsx.
FROM node:20-slim

WORKDIR /app

# Non-root user — matches the k8s securityContext (runAsUser/runAsGroup 10001).
RUN groupadd --gid 10001 orbit \
    && useradd --uid 10001 --gid orbit --shell /bin/sh --no-create-home orbit \
    && chown -R orbit:orbit /app

# Install deps first for layer caching. This package has no lockfile of its own
# (for local dev it resolves through the orbit-www bun workspace); npm resolves
# @temporalio/* + tsx here for the standalone image. @temporalio/core-bridge
# ships prebuilt linux binaries, so no native toolchain is required.
COPY --chown=orbit:orbit package.json ./
RUN npm install --no-audit --no-fund

# App source: the client-safe contract, the workflow, the activity, the worker
# entry, plus tsconfig.
COPY --chown=orbit:orbit tsconfig.json ./
COPY --chown=orbit:orbit src ./src

USER orbit
ENV NODE_ENV=production

# `npm start` → `tsx src/worker.ts`. Config is read from the environment:
# TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, ORBIT_API_URL, ORBIT_INTERNAL_API_KEY,
# AUTOMATION_SCHEDULE_TZ.
CMD ["npm", "start"]
