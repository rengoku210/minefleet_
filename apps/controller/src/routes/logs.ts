import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { queryAll } from '../db/pool.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/logs/audit
  app.get<{ Querystring: { limit?: string; userId?: string } }>(
    '/audit', { preHandler: [requireAuth] }, async (request, reply) => {
      const limit = parseInt((request.query as any).limit || '100', 10);
      const userId = (request.query as any).userId;

      let sql = `SELECT al.*, u.email as user_email
                 FROM audit_logs al
                 LEFT JOIN users u ON u.id = al.user_id`;
      const params: unknown[] = [];

      if (userId) {
        sql += ' WHERE al.user_id = $1';
        params.push(userId);
      }

      sql += ' ORDER BY al.created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const logs = await queryAll(sql, params);
      return reply.send({ success: true, data: { logs } });
    },
  );

  // GET /api/logs/notifications
  app.get<{ Querystring: { limit?: string; unreadOnly?: string } }>(
    '/notifications', { preHandler: [requireAuth] }, async (request, reply) => {
      const limit = parseInt((request.query as any).limit || '50', 10);
      const unreadOnly = (request.query as any).unreadOnly === 'true';

      let sql = `SELECT n.*, m.name as machine_name
                 FROM notifications n
                 LEFT JOIN machines m ON m.id = n.machine_id`;

      if (unreadOnly) sql += ' WHERE n.read = false';
      sql += ` ORDER BY n.created_at DESC LIMIT $1`;

      const notifications = await queryAll(sql, [limit]);
      return reply.send({ success: true, data: { notifications } });
    },
  );

  // PATCH /api/logs/notifications/:id/read
  app.patch<{ Params: { id: string } }>(
    '/notifications/:id/read', { preHandler: [requireAuth] }, async (request, reply) => {
      const { query: dbQuery } = await import('../db/pool.js');
      await dbQuery('UPDATE notifications SET read = true WHERE id = $1', [request.params.id]);
      return reply.send({ success: true });
    },
  );
}
