# MineFleet Development Guide

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`npm install -g pnpm`)
- PostgreSQL 16+ (or Docker for a local instance)

## Setup

```bash
# Install all dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env with your local PostgreSQL credentials

# Build shared packages (required first)
pnpm --filter @minefleet/shared-types build
pnpm --filter @minefleet/protocol build

# Run migrations
pnpm db:migrate

# Seed admin user
pnpm --filter @minefleet/controller seed
```

## Development Servers

```bash
# Start all in dev mode
pnpm dev

# Or individually:
pnpm --filter @minefleet/controller dev    # API on :3001
pnpm --filter @minefleet/dashboard dev      # UI on :3000
pnpm --filter @minefleet/agent dev          # Agent
```

## Testing

```bash
pnpm test                                    # All tests
pnpm --filter @minefleet/controller test     # Controller tests
pnpm --filter @minefleet/agent test          # Agent tests
pnpm typecheck                               # Type checking
```

## Project Structure

```
apps/
  controller/    Fastify API server
  dashboard/     React SPA
  agent/         Mining agent daemon
packages/
  shared-types/  TypeScript interfaces
  protocol/      WebSocket message types
deploy/          Docker Compose configs
installer/       One-command install scripts
docs/            Documentation
```
