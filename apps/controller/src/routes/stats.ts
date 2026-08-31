import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/stats/overview
  app.get('/overview', { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const machines = await storage.listMachines();
    const now = Date.now();

    let onlineCount = 0;
    let offlineCount = 0;
    let totalCpu = 0;
    let totalGpu = 0;
    let totalHashrate = 0;
    let maxTemp = 0;
    let activeStates = 0;

    for (const m of machines) {
      const lastSeenMs = m.lastHeartbeat ? new Date(m.lastHeartbeat).getTime() : 0;
      const isOnline = lastSeenMs > 0 && (now - lastSeenMs) < 60000;
      if (isOnline) {
        onlineCount++;
      } else {
        offlineCount++;
      }

      const state = await storage.getMachineState(m.id);
      if (state && isOnline) {
        activeStates++;
        totalCpu += state.cpuPercent || 0;
        totalGpu += state.gpuPercent || 0;
        totalHashrate += state.hashrate || 0;
        if ((state.cpuTempC || 0) > maxTemp) maxTemp = state.cpuTempC || 0;
      }
    }

    return reply.send({
      success: true,
      data: {
        total_machines: machines.length,
        online_machines: onlineCount,
        offline_machines: offlineCount,
        avg_cpu: activeStates > 0 ? Math.round((totalCpu / activeStates) * 10) / 10 : 0,
        avg_gpu: activeStates > 0 ? Math.round((totalGpu / activeStates) * 10) / 10 : 0,
        avg_hashrate: activeStates > 0 ? Math.round((totalHashrate / activeStates) * 10) / 10 : 0,
        total_hashrate: Math.round(totalHashrate * 10) / 10,
        max_temp: maxTemp,
      },
    });
  });

  // GET /api/stats/machines/:id
  app.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    '/machines/:id', { preHandler: [requireAuth] }, async (request, reply) => {
      const { id } = request.params;
      const period = (request.query as any).period || 'hour';

      let durationMinutes: number;
      switch (period) {
        case 'day': durationMinutes = 1440; break;
        case 'week': durationMinutes = 10080; break;
        case 'month': durationMinutes = 14400; break; // 10 days
        default: durationMinutes = 60; break;
      }

      const storage = getStorage();
      const points = await storage.getTelemetryHistory(id, durationMinutes);

      const formatted = points.map((p) => ({
        time: new Date(p.t).toISOString(),
        cpu: p.c,
        ram: p.r,
        gpu: p.g,
        hashrate: p.h,
        temp: p.temp,
      }));

      return reply.send({ success: true, data: { period, points: formatted } });
    },
  );
}
