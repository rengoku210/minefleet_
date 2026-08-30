# MineFleet Troubleshooting

## Agent won't connect

1. Check agent status: `minefleet-agent status` or `systemctl status minefleet-agent`
2. Check logs: `journalctl -u minefleet-agent -f` (Linux) or `C:\ProgramData\MineFleet\logs\` (Windows)
3. Verify controller URL is reachable from the agent machine
4. Check firewall allows outbound HTTPS/WSS connections

## Machine shows offline

- Agent may have lost connection. Check agent logs.
- Controller marks machines offline after 90 seconds without heartbeat.
- Agent will automatically reconnect with exponential backoff.

## Mining not starting

1. Verify mining is enabled in the machine config (dashboard)
2. Check workload protection isn't pausing mining (high CPU load)
3. Check thermal protection isn't pausing mining (high temperature)
4. Check agent logs for backend errors

## Database migration errors

```bash
# Check migration status
pnpm --filter @minefleet/controller db:migrate

# Roll back last migration
pnpm --filter @minefleet/controller db:migrate:down
```

## Docker issues

```bash
# Rebuild containers
docker compose build --no-cache

# View logs
docker compose logs -f controller

# Reset database
docker compose down -v
docker compose up -d
```
