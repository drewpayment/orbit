# To use this Dockerfile, you have to set `output: 'standalone'` in your next.config.mjs file.
# From https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile

FROM node:22.17.0-alpine AS base

# Install bun
RUN apk add --no-cache libc6-compat bash curl unzip \
  && curl -fsSL https://bun.sh/install | bash \
  && mv /root/.bun/bin/bun /usr/local/bin/bun \
  && ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

# Dummy env vars for Next.js build — modules validate these at import time
# during page data collection. Real values injected at runtime via K8s secrets.
ENV DOCKER_BUILD=1 \
    DATABASE_URI=mongodb://placeholder:27017/build \
    PAYLOAD_SECRET=build-placeholder-secret-min-32-chars-long \
    BETTER_AUTH_SECRET=build-placeholder-secret \
    RESEND_API_KEY=re_placeholder \
    ENCRYPTION_KEY=QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE= \
    GITHUB_APP_ID=000000 \
    GITHUB_APP_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFb3dJQkFBS0NBUUVBMHM= \
    GITHUB_APP_WEBHOOK_SECRET=placeholder-webhook-secret \
    ORBIT_REGISTRY_JWT_SECRET=placeholder-jwt-secret \
    NEXT_PUBLIC_DOCS_URL=https://orbit-docs.hoytlabs.app/docs \
    NEXT_PUBLIC_GITHUB_APP_NAME=orbit-idp

RUN mkdir -p public && bun run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets (created during build even if originally empty)
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "server.js"]
