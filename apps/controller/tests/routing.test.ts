import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, getCanonicalPublicUrl } from '../src/config.js';
import { getStorage } from '../src/storage/index.js';
import handler from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('Vercel API & Controller Routing Test Suite', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const config = loadConfig();
    const storage = getStorage();
    await storage.init();
    app = await buildApp(config);
    await app.ready();
  });

  it('Canonical Public URL should NEVER use temporary deployment URL', () => {
    const url = getCanonicalPublicUrl();
    expect(url).not.toContain('localhost:3001');
    expect(url).not.toMatch(/-[a-z0-9]+-.*\.vercel\.app/);
    expect(url).toBe('https://minefleet.vercel.app');
  });

  it('GET /health should return JSON 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
  });

  it('GET /api/health should return JSON 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
  });

  it('POST /api/auth/login with valid admin credentials should return JSON with tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@minefleet.local',
        password: 'Admin1234!',
      },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.data.accessToken).toBeDefined();
    expect(json.data.user.email).toBe('admin@minefleet.local');
  });

  it('POST /api/auth/login with wrong password should return JSON 401 (NOT HTML)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@minefleet.local',
        password: 'wrong-password',
      },
    });
    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/enrollment-tokens should generate stable production command', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@minefleet.local',
        password: 'Admin1234!',
      },
    });
    const { accessToken } = JSON.parse(loginRes.body).data;

    const res = await app.inject({
      method: 'POST',
      url: '/api/enrollment-tokens',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: { label: 'Test Machine' },
    });

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.body);
    expect(json.data.installCommandWindows).toContain('https://minefleet.vercel.app/install.ps1?token=');
    expect(json.data.installCommandWindows).not.toContain('localhost');
    expect(json.data.installCommandLinux).toContain('https://minefleet.vercel.app/install.sh?token=');
  });

  it('GET /install.ps1 should return complete PowerShell script (not fallback stub)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/install.ps1?token=test-token-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('$Token = "test-token-123"');
    expect(res.body).toContain('MineFleetAgent');
    expect(res.body).toContain('nssm');
    expect(res.body.length).toBeGreaterThan(3000);
  });

  it('GET /install.sh should return complete Linux Bash script', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/install.sh?token=test-token-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/x-shellscript');
    expect(res.body).toContain('TOKEN="test-token-123"');
    expect(res.body).toContain('minefleet-agent.service');
    expect(res.body.length).toBeGreaterThan(2000);
  });
});
