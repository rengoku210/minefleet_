import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/schedules
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ success: true, data: { schedules: [] } });
  });
}
