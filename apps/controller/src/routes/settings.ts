import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { queryOne, query } from '../db/pool.js';
import { auditLog } from '../middleware/audit.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const electricityPrice = await queryOne("SELECT value FROM settings WHERE key = 'electricity_price_per_kwh'");
    const retentionDays = await queryOne("SELECT value FROM settings WHERE key = 'telemetry_retention_days'");
    const currency = await queryOne("SELECT value FROM settings WHERE key = 'default_currency'");

    return reply.send({
      success: true,
      data: {
        electricityPricePerKwh: electricityPrice?.value?.value ?? 0.12,
        telemetryRetentionDays: retentionDays?.value?.value ?? 30,
        defaultCurrency: currency?.value?.value ?? 'USD',
      },
    });
  });

  // PATCH /api/settings
  app.patch<{ Body: { electricityPricePerKwh?: number; telemetryRetentionDays?: number; defaultCurrency?: string } }>(
    '/', { preHandler: [requireAdmin] }, async (request, reply) => {
      const { electricityPricePerKwh, telemetryRetentionDays, defaultCurrency } = request.body || {};

      if (electricityPricePerKwh !== undefined) {
        await query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('electricity_price_per_kwh', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [JSON.stringify({ value: electricityPricePerKwh })],
        );
      }
      if (telemetryRetentionDays !== undefined) {
        await query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('telemetry_retention_days', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [JSON.stringify({ value: telemetryRetentionDays })],
        );
      }
      if (defaultCurrency !== undefined) {
        await query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('default_currency', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [JSON.stringify({ value: defaultCurrency })],
        );
      }

      await auditLog(request, 'update_settings', 'settings', undefined, request.body as Record<string, unknown>);
      return reply.send({ success: true });
    },
  );
}
