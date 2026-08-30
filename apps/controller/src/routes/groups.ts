import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { getStorage } from '../storage/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { randomUUID } from 'node:crypto';

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/groups
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const groups = await storage.listGroups();
    const machines = await storage.listMachines();

    const counts = new Map<string, number>();
    for (const m of machines) {
      if (m.groupId) {
        counts.set(m.groupId, (counts.get(m.groupId) || 0) + 1);
      }
    }

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description || null,
      default_config: g.defaultConfig || null,
      machine_count: counts.get(g.id) || 0,
      created_at: g.createdAt,
    }));

    return reply.send({ success: true, data: { groups: result } });
  });

  // POST /api/groups
  app.post<{ Body: { name: string; description?: string; defaultConfig?: any } }>(
    '/',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const storage = getStorage();
      const { name, description, defaultConfig } = request.body || {};
      if (!name) throw new ValidationError('Group name is required');

      const existing = (await storage.listGroups()).find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (existing) throw new ConflictError('A group with this name already exists');

      const id = randomUUID();
      await storage.saveGroup({
        id,
        name,
        description: description || null,
        defaultConfig: defaultConfig || null,
        createdAt: new Date().toISOString(),
      });

      await auditLog(request, 'create_group', 'machine_group', id, { name });
      return reply.status(201).send({ success: true, data: { id, name } });
    },
  );

  // PATCH /api/groups/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; defaultConfig?: any } }>(
    '/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const storage = getStorage();
      const group = await storage.getGroup(request.params.id);
      if (!group) throw new NotFoundError('Machine group');

      const { name, description, defaultConfig } = request.body || {};
      if (name !== undefined) group.name = name;
      if (description !== undefined) group.description = description;
      if (defaultConfig !== undefined) group.defaultConfig = defaultConfig;

      await storage.saveGroup(group);
      await auditLog(request, 'update_group', 'machine_group', request.params.id);
      return reply.send({ success: true });
    },
  );

  // DELETE /api/groups/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const deleted = await storage.deleteGroup(request.params.id);
    if (!deleted) throw new NotFoundError('Machine group');

    await auditLog(request, 'delete_group', 'machine_group', request.params.id);
    return reply.send({ success: true });
  });
}
