import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
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

  it('POST /auth/login (root alias) should also return JSON response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@minefleet.local',
        password: 'Admin1234!',
      },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
  });

  it('GET /api/unknown-route should return JSON 404 (NEVER HTML)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/non-existent-endpoint',
    });
    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('GET /install.ps1 should return installer script with text/plain content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/install.ps1?token=test-token-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('MineFleet');
  });

  it('GET /install.sh should return Linux script with shellscript content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/install.sh?token=test-token-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/x-shellscript');
    expect(res.body).toContain('MineFleet');
  });

  it('Simulated Vercel serverless handler should process requests and write JSON headers', async () => {
    let statusCode = 0;
    let headers: Record<string, string> = {};
    let body = '';

    const req = {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      body: { email: 'admin@minefleet.local', password: 'Admin1234!' },
    };

    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => { headers[k] = v; },
      end: (data: string) => { body = data; },
    };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toContain('application/json');
    const json = JSON.parse(body);
    expect(json.success).toBe(true);
    expect(json.data.accessToken).toBeDefined();
  });
});
