import { loadConfig } from './config.js';
import { getStorage } from './storage/index.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';
import type { FastifyInstance } from 'fastify';

let appInstance: FastifyInstance | null = null;
let initPromise: Promise<FastifyInstance> | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (appInstance) return appInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const config = loadConfig();
    const storage = getStorage();
    try {
      await storage.init();
    } catch (err) {
      logger.error({ err }, 'Storage init error (continuing with memory fallback)');
    }
    const app = await buildApp(config);
    await app.ready();
    appInstance = app;
    return app;
  })();

  return initPromise;
}

// Serverless Function Handler (Vercel / Lambda / Edge)
export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();

    const matchedPath = req.headers?.['x-matched-path'] || req.headers?.['x-vercel-matched-path'];
    let targetUrl = req.url || '/';
    if (matchedPath && typeof matchedPath === 'string' && matchedPath !== '/api/index' && matchedPath !== '/api') {
      const queryIdx = targetUrl.indexOf('?');
      const query = queryIdx !== -1 ? targetUrl.substring(queryIdx) : '';
      targetUrl = matchedPath + query;
    }

    const method = req.method || 'GET';
    const headers = req.headers || {};

    let payload: any = undefined;
    if (req.body !== undefined && req.body !== null) {
      payload = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
      if (typeof req.body === 'object' && !headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
    }

    const response = await app.inject({
      method,
      url: targetUrl,
      headers,
      payload,
    });

    res.statusCode = response.statusCode;
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    }
    res.end(response.rawPayload);
  } catch (err: any) {
    logger.error({ err: err?.message || err }, 'Serverless handler error');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err?.message || 'Internal server error' },
      }));
    }
  }
}

// Standalone Server Entrypoint (Node / Docker)
async function main() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }

  const config = loadConfig();
  logger.info({ env: config.nodeEnv }, 'Starting MineFleet Controller standalone server');

  const app = await getApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ host: config.host, port: config.port }, 'MineFleet Controller is running');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.argv[1] && (process.argv[1].endsWith('dist/index.js') || process.argv[1].endsWith('src/index.ts'))) {
  main();
}
