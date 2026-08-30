# MineFleet

Centralized multi-PC crypto mining management system.

## Quick Start

### Prerequisites
- Node.js >= 20
- pnpm >= 9
- PostgreSQL 16+
- Docker & Docker Compose (for deployment)

### Development

```bash
# Install dependencies
pnpm install

# Build shared packages
pnpm build --filter @minefleet/shared-types --filter @minefleet/protocol

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Run database migrations
pnpm db:migrate

# Seed admin user
pnpm --filter @minefleet/controller seed

# Start development servers
pnpm dev
```

### Docker Deployment

```bash
cd deploy
cp .env.example .env
# Edit .env with production values
docker compose up -d
```

### Adding a Machine

1. Log into the dashboard
2. Go to Machines → Add Machine
3. Copy the install command
4. Run it on the target machine

## Architecture

- **Controller**: Fastify REST API + WebSocket server
- **Dashboard**: React SPA
- **Agent**: Lightweight daemon per managed PC
- **Database**: PostgreSQL

See [DEPLOYMENT.md](DEPLOYMENT.md) for full deployment guide.
See [SECURITY.md](SECURITY.md) for security documentation.
