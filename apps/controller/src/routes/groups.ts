import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { query, queryOne, queryAll } from '../db/pool.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/groups
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const groups = await queryAll(
      `SELECT mg.id, mg.name, mg.description, mg.default_config, mg.created_at,
              COUNT(m.id)::int as machine_count
       FROM machine_groups mg
       LEFT JOIN machines m ON m.group_id = mg.id
       GROUP BY mg.id
       ORDER BY mg.name ASC`,
    );
    return reply.send({ success: true, data: { groups } });
  });

  // POST /api/groups
  app.post<{ Body: { name: string; description?: string; defaultConfig?: any } }>(
    '/',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { name, description, defaultConfig } = request.body || {};
      if (!name) throw new ValidationError('Group name is required');

      const existing = await queryOne('SELECT id FROM machine_groups WHERE name = $1', [name]);
      if (existing) throw new ConflictError('A group with this name already exists');

      const result = await queryOne<{ id: string }>(
        `INSERT INTO machine_groups (id, name, description, default_config)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING id`,
        [name, description || null, defaultConfig ? JSON.stringify(defaultConfig) : null],
      );

      // Create group_configs entry
      await query(
        `INSERT INTO group_configs (id, group_id, config)
         VALUES (gen_random_uuid(), $1, $2)`,
        [result!.id, defaultConfig ? JSON.stringify(defaultConfig) : '{}'],
      );

      await auditLog(request, 'create_group', 'machine_group', result!.id, { name });
      return reply.status(201).send({ success: true, data: { id: result!.id, name } });
    },
  );

  // PATCH /api/groups/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; defaultConfig?: any } }>(
    '/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { name, description, defaultConfig } = request.body || {};
      const sets: string[] = [];
      const values: unknown[] = [request.params.id];
      let idx = 2;

      if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
      if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
      if (defaultConfig !== undefined) { sets.push(`default_config = $${idx++}`); values.push(JSON.stringify(defaultConfig)); }

      if (sets.length === 0) return reply.send({ success: true });

      const result = await query(
        `UPDATE machine_groups SET ${sets.join(', ')} WHERE id = $1`,
        values,
      );
      if (result.rowCount === 0) throw new NotFoundError('Machine group');

      if (defaultConfig !== undefined) {
        await query(
          `UPDATE group_configs SET config = $2, version = version + 1, updated_at = NOW() WHERE group_id = $1`,
          [request.params.id, JSON.stringify(defaultConfig)],
        );
      }

      await auditLog(request, 'update_group', 'machine_group', request.params.id);
      return reply.send({ success: true });
    },
  );

  // DELETE /api/groups/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const result = await query('DELETE FROM machine_groups WHERE id = $1', [request.params.id]);
    if (result.rowCount === 0) throw new NotFoundError('Machine group');
    await auditLog(request, 'delete_group', 'machine_group', request.params.id);
    return reply.send({ success: true });
  });
}
