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

  // Safe JSON content type parser for serverless payloads and PowerShell clients
  app.addContentTypeParser(
    ['application/json', 'text/plain'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      if (!body || (Buffer.isBuffer(body) && body.length === 0)) {
        return done(null, {});
      }
      try {
        const str = Buffer.isBuffer(body) ? body.toString('utf-8') : String(body);
        if (!str.trim()) return done(null, {});
        const json = JSON.parse(str);
        done(null, json);
      } catch (err: any) {
        done(null, {});
      }
    }
  );

  // Global error handler
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode || (error instanceof AppError ? error.statusCode : undefined);
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        success: false,
        error: {
          code: error.code || 'CLIENT_ERROR',
          message: error.message || 'Client error',
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

    logger.error({ err: error?.message || error, stack: error?.stack, url: request.url }, 'Unhandled error');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An internal server error occurred',
      },
    });
  });

  // Custom JSON 404 handler (ensures API 404 is NEVER HTML)
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
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

  // Root welcome
  app.get('/', async () => {
    return { status: 'ok', name: 'MineFleet Controller API', version: '0.2.0' };
  });

  // Helper to register all standard domain routes
  const registerDomainRoutes = async (instance: FastifyInstance) => {
    instance.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });
    await instance.register(authRoutes, { prefix: '/auth' });
    await instance.register(userRoutes, { prefix: '/users' });
    await instance.register(enrollmentRoutes, { prefix: '/enrollment-tokens' });
    await instance.register(machineRoutes, { prefix: '/machines' });
    await instance.register(groupRoutes, { prefix: '/groups' });
    await instance.register(scheduleRoutes, { prefix: '/schedules' });
    await instance.register(statsRoutes, { prefix: '/stats' });
    await instance.register(logRoutes, { prefix: '/logs' });
    await instance.register(settingsRoutes, { prefix: '/settings' });
  };

  // 1. Register with /api prefix (primary API routes)
  await app.register(registerDomainRoutes, { prefix: '/api' });

  // 2. Also register at root as alias (handles cases where serverless proxies strip /api)
  await app.register(registerDomainRoutes);

  // 3. Installer and agent bundle routes (/install.ps1, /install.sh, /api/install.ps1, /api/install.sh, /api/agent/bundle)
  await app.register(installerRoutes);

  return app;
}
