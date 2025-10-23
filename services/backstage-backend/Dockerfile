# Stage 1: Build
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Install dependencies
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile; \
    else yarn install --frozen-lockfile; fi

# Copy source code
COPY . .

# Build application
RUN yarn build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Install production dependencies only
RUN if [ -f yarn.lock ]; then yarn install --production --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci --production; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --prod --frozen-lockfile; \
    else yarn install --production --frozen-lockfile; fi

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/app-config.yaml ./

# Expose Backstage backend port
EXPOSE 7007

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:7007/healthcheck', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start Backstage backend
CMD ["node", "packages/backend", "--config", "app-config.yaml"]
