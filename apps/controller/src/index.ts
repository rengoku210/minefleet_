import { loadConfig } from './config.js';
import { getStorage } from './storage/index.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';

let appPromise: ReturnType<typeof buildApp> | null = null;

export async function getApp() {
  if (!appPromise) {
    const config = loadConfig();
    const storage = getStorage();
    await storage.init();
    appPromise = buildApp(config);
  }
  return appPromise;
}

// Handler for Vercel Serverless Function execution
export default async function handler(req: any, res: any) {
  const app = await getApp();
  await app.ready();
  app.server.emit('request', req, res);
}

// Standalone server entrypoint (Node / Docker / Local dev)
async function main() {
  if (process.env.VERCEL) {
    // Under Vercel serverless, the exported handler handles incoming requests
    return;
  }

  const config = loadConfig();
  logger.info({ env: config.nodeEnv }, 'Starting MineFleet Controller');

  const storage = getStorage();
  await storage.init();

  const app = await buildApp(config);

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

main();
