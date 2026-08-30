import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';
import { auditLog } from '../middleware/audit.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const settings = await storage.getSettings();
    return reply.send({ success: true, data: settings });
  });

  // PATCH /api/settings
  app.patch<{ Body: { electricityPricePerKwh?: number; telemetryRetentionDays?: number; defaultCurrency?: string } }>(
    '/', { preHandler: [requireAdmin] }, async (request, reply) => {
      const storage = getStorage();
      const { electricityPricePerKwh, telemetryRetentionDays, defaultCurrency } = request.body || {};

      await storage.saveSettings({
        electricityPricePerKwh,
        telemetryRetentionDays,
        defaultCurrency,
      });

      await auditLog(request, 'update_settings', 'settings', undefined, request.body as Record<string, unknown>);
      return reply.send({ success: true });
    },
  );
}
