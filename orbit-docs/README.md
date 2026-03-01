# Orbit Docs

Public documentation site for [Orbit](https://github.com/drewpayment/orbit), the open-source Internal Developer Portal.

Built with [Fumadocs](https://fumadocs.dev) + Next.js 15.

## Development

```bash
bun install
bun run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Build

```bash
bun run build
bun run start
```

## Deployment

The docs site is a standalone Next.js app that can be deployed anywhere:

- **Vercel** — `vercel deploy`
- **Docker** — Build with the included Dockerfile
- **Static export** — Change `next.config.mjs` output to `'export'`
