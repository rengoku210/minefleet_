# MineFleet Deployment Guide

## Docker Compose (Recommended)

### Prerequisites
- Docker Engine 24+
- Docker Compose v2+

### Setup

1. Clone the repository
2. Navigate to the deploy directory:
   ```bash
   cd deploy
   ```
3. Create your environment file:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` with secure values:
   - `POSTGRES_PASSWORD` - strong database password
   - `JWT_SECRET` - generate with `openssl rand -hex 32`
   - `JWT_REFRESH_SECRET` - generate with `openssl rand -hex 32`
   - `ADMIN_EMAIL` - your admin email
   - `ADMIN_PASSWORD` - strong admin password
   - `CONTROLLER_URL` - public URL of your controller

5. Start the services:
   ```bash
   docker compose up -d
   ```

6. Check status:
   ```bash
   docker compose ps
   docker compose logs controller
   ```

### Services

| Service | Port | Description |
|---------|------|-------------|
| dashboard | 3000 | Web UI (nginx) |
| controller | 3001 | API + WebSocket |
| postgres | 5432 | Database |

### Reverse Proxy (Production)

For production, place nginx or Caddy in front:

```nginx
server {
    listen 443 ssl;
    server_name minefleet.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
    }

    location /ws/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

## Adding Machines

1. Log into the dashboard at `https://your-domain.com`
2. Navigate to **Machines** > **Add Machine**
3. Copy the install command
4. Run on the target PC:
   - **Linux**: `curl -fsSL ... | sudo bash`
   - **Windows**: Run PowerShell as Administrator

## Backup

```bash
# Database backup
docker compose exec postgres pg_dump -U minefleet minefleet > backup.sql

# Restore
cat backup.sql | docker compose exec -T postgres psql -U minefleet minefleet
```
