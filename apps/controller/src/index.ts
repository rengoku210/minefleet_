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

// Serverless Function Handler (Vercel / AWS Lambda / Edge adapter)
export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
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

  // Only start TCP listener if directly executed
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

// Only run main if file is run directly (not imported as serverless function)
if (process.argv[1] && (process.argv[1].endsWith('dist/index.js') || process.argv[1].endsWith('src/index.ts'))) {
  main();
}
