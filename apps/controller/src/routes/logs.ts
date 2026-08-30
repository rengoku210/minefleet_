import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/logs/audit
  app.get<{ Querystring: { limit?: string; userId?: string } }>(
    '/audit', { preHandler: [requireAuth] }, async (request, reply) => {
      const limit = parseInt((request.query as any)?.limit || '100', 10);
      const userId = (request.query as any)?.userId;
      const storage = getStorage();

      const logs = await storage.listAuditLogs(limit, userId);
      return reply.send({ success: true, data: { logs } });
    },
  );

  // GET /api/logs/notifications
  app.get('/notifications', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ success: true, data: { notifications: [] } });
  });
}
