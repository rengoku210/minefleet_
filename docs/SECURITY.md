# MineFleet Security Model

## Authentication

- **Dashboard**: JWT access tokens (15 min) + httpOnly refresh cookies (7 days)
- **Agents**: Per-machine API tokens issued during enrollment
- **Enrollment**: One-time tokens, SHA-256 hashed in DB, 1-hour TTL

## Credential Storage

- User passwords: bcrypt (cost 12)
- Enrollment tokens: SHA-256 hash (high-entropy, no rainbow table risk)
- Machine API tokens: SHA-256 hash
- No plaintext credentials stored after issuance

## Access Control

| Role | Capabilities |
|------|-------------|
| Admin | Full CRUD on all resources |
| Viewer | Read-only access |
| Agent | Own machine data only |

## Rate Limiting

- Login: 5 requests/minute/IP
- Enrollment: 10 requests/minute/IP
- General API: 100 requests/minute/session

## Agent Security

- Agents connect outbound only (no inbound ports)
- Agents cannot access admin endpoints
- Agents authenticate via machine-specific tokens
- Tokens can be rotated from the dashboard

## Best Practices

1. Always use HTTPS in production
2. Generate strong JWT secrets (`openssl rand -hex 32`)
3. Rotate admin passwords regularly
4. Monitor audit logs for suspicious activity
5. Keep agent software updated
