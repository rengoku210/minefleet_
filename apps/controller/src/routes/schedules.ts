import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { query, queryOne, queryAll } from '../db/pool.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/schedules
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const schedules = await queryAll(
      `SELECT s.*, m.name as machine_name, mg.name as group_name
       FROM schedules s
       LEFT JOIN machines m ON m.id = s.machine_id
       LEFT JOIN machine_groups mg ON mg.id = s.group_id
       ORDER BY s.created_at DESC`,
    );
    return reply.send({ success: true, data: { schedules } });
  });

  // POST /api/schedules
  app.post<{ Body: {
    machineId?: string; groupId?: string; name: string;
    startTime: string; endTime: string; days: string;
    configOverride: Record<string, unknown>; enabled?: boolean;
  } }>('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { machineId, groupId, name, startTime, endTime, days, configOverride, enabled = true } = request.body;

    if (!name || !startTime || !endTime || !days) {
      throw new ValidationError('name, startTime, endTime, and days are required');
    }

    const result = await queryOne<{ id: string }>(
      `INSERT INTO schedules (id, machine_id, group_id, name, start_time, end_time, days, config_override, enabled)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [machineId || null, groupId || null, name, startTime, endTime, days,
       JSON.stringify(configOverride || {}), enabled],
    );

    await auditLog(request, 'create_schedule', 'schedule', result!.id);
    return reply.status(201).send({ success: true, data: { id: result!.id } });
  });

  // PATCH /api/schedules/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
      const { name, startTime, endTime, days, configOverride, enabled } = request.body as any;
      const sets: string[] = [];
      const values: unknown[] = [request.params.id];
      let idx = 2;

      if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
      if (startTime !== undefined) { sets.push(`start_time = $${idx++}`); values.push(startTime); }
      if (endTime !== undefined) { sets.push(`end_time = $${idx++}`); values.push(endTime); }
      if (days !== undefined) { sets.push(`days = $${idx++}`); values.push(days); }
      if (configOverride !== undefined) { sets.push(`config_override = $${idx++}`); values.push(JSON.stringify(configOverride)); }
      if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); values.push(enabled); }

      if (sets.length === 0) return reply.send({ success: true });

      const result = await query(`UPDATE schedules SET ${sets.join(', ')} WHERE id = $1`, values);
      if (result.rowCount === 0) throw new NotFoundError('Schedule');

      await auditLog(request, 'update_schedule', 'schedule', request.params.id);
      return reply.send({ success: true });
    },
  );

  // DELETE /api/schedules/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const result = await query('DELETE FROM schedules WHERE id = $1', [request.params.id]);
    if (result.rowCount === 0) throw new NotFoundError('Schedule');
    await auditLog(request, 'delete_schedule', 'schedule', request.params.id);
    return reply.send({ success: true });
  });
}
