import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import type { AppConfig } from './config.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import { authRoutes } from './routes/auth.js';
import { machineRoutes } from './routes/machines.js';
import { enrollmentRoutes } from './routes/enrollment.js';
import { groupRoutes } from './routes/groups.js';
import { scheduleRoutes } from './routes/schedules.js';
import { statsRoutes } from './routes/stats.js';
import { logRoutes } from './routes/logs.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { installerRoutes } from './routes/installer.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // Global error handler
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
    }

    logger.error({ err: error, url: request.url }, 'Unhandled error');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal server error occurred',
      },
    });
  });

  // Plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Dashboard served separately
  });

  await app.register(cookie, {
    secret: config.jwt.secret,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // Decorate with config
  app.decorate('config', config);

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Root welcome
  app.get('/', async () => {
    return { status: 'ok', name: 'MineFleet Controller API', version: '0.2.0' };
  });

  // Installer and agent bundle routes (/install.ps1, /install.sh, /api/agent/bundle)
  await app.register(installerRoutes);

  // API routes
  await app.register(async (api) => {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(userRoutes, { prefix: '/users' });
    await api.register(enrollmentRoutes, { prefix: '/enrollment-tokens' });
    await api.register(machineRoutes, { prefix: '/machines' });
    await api.register(machineRoutes, { prefix: '/agent' }); // Alias /api/agent/heartbeat -> /api/machines/heartbeat
    await api.register(groupRoutes, { prefix: '/groups' });
    await api.register(scheduleRoutes, { prefix: '/schedules' });
    await api.register(statsRoutes, { prefix: '/stats' });
    await api.register(logRoutes, { prefix: '/logs' });
    await api.register(settingsRoutes, { prefix: '/settings' });
  }, { prefix: '/api' });

  return app;
}
