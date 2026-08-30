import { loadConfig } from './config.js';
import { initPool, closePool } from './db/pool.js';
import { initDatabaseSchema } from './db/schema.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';
import { initConnectionRegistry } from './ws/connections.js';

async function main() {
  const config = loadConfig();
  logger.info({ env: config.nodeEnv }, 'Starting MineFleet Controller');

  // Initialize database
  await initPool(config.database.connectionString);
  await initDatabaseSchema();

  // Build app
  const app = await buildApp(config);

  // Initialize WebSocket connection registry
  initConnectionRegistry();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start listening
  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ host: config.host, port: config.port }, 'MineFleet Controller is running');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
