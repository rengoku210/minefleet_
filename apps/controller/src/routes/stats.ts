import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { queryAll, queryOne } from '../db/pool.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/stats/overview
  app.get('/overview', { preHandler: [requireAuth] }, async (request, reply) => {
    const totals = await queryOne(
      `SELECT
        COUNT(*)::int as total_machines,
        COUNT(*) FILTER (WHERE status = 'online')::int as online_machines,
        COUNT(*) FILTER (WHERE status = 'offline')::int as offline_machines
       FROM machines`,
    );

    const recentTelemetry = await queryOne(
      `SELECT
        AVG(cpu_percent) as avg_cpu,
        AVG(gpu_percent) as avg_gpu,
        AVG(hashrate) as avg_hashrate,
        SUM(hashrate) as total_hashrate,
        MAX(cpu_temp_c) as max_temp
       FROM telemetry
       WHERE recorded_at > NOW() - INTERVAL '5 minutes'`,
    );

    return reply.send({ success: true, data: { ...totals, ...recentTelemetry } });
  });

  // GET /api/stats/machines/:id
  app.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    '/machines/:id', { preHandler: [requireAuth] }, async (request, reply) => {
      const { id } = request.params;
      const period = (request.query as any).period || 'hour';

      let interval: string;
      let bucket: string;
      switch (period) {
        case 'day': interval = '24 hours'; bucket = '15 minutes'; break;
        case 'week': interval = '7 days'; bucket = '1 hour'; break;
        case 'month': interval = '30 days'; bucket = '6 hours'; break;
        default: interval = '1 hour'; bucket = '1 minute'; break;
      }

      const data = await queryAll(
        `SELECT
          date_trunc('minute', recorded_at) as time,
          AVG(cpu_percent) as cpu,
          AVG(ram_percent) as ram,
          AVG(gpu_percent) as gpu,
          AVG(hashrate) as hashrate,
          MAX(cpu_temp_c) as temp
         FROM telemetry
         WHERE machine_id = $1 AND recorded_at > NOW() - INTERVAL '${interval}'
         GROUP BY date_trunc('minute', recorded_at)
         ORDER BY time ASC`,
        [id],
      );

      return reply.send({ success: true, data: { period, points: data } });
    },
  );

  // GET /api/stats/sessions/:machineId
  app.get<{ Params: { machineId: string } }>(
    '/sessions/:machineId', { preHandler: [requireAuth] }, async (request, reply) => {
      const sessions = await queryAll(
        `SELECT * FROM mining_sessions
         WHERE machine_id = $1
         ORDER BY started_at DESC
         LIMIT 50`,
        [request.params.machineId],
      );
      return reply.send({ success: true, data: { sessions } });
    },
  );
}
