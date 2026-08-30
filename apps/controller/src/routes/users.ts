import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { getStorage } from '../storage/index.js';
import { hashPassword } from '../utils/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { randomUUID } from 'node:crypto';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users - list all users
  app.get('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const users = await storage.listUsers();
    const sanitized = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      totp_enabled: u.totpEnabled || false,
      created_at: u.createdAt,
      updated_at: u.updatedAt,
    }));
    return reply.send({ success: true, data: { users: sanitized } });
  });

  // POST /api/users - create user
  app.post<{ Body: { email: string; password: string; role?: 'admin' | 'viewer' } }>('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { email, password, role = 'viewer' } = request.body || {};
    const storage = getStorage();

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }
    if (!['admin', 'viewer'].includes(role)) {
      throw new ValidationError('Role must be admin or viewer');
    }
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const now = new Date().toISOString();

    await storage.saveUser({
      id,
      email,
      passwordHash,
      role,
      createdAt: now,
      updatedAt: now,
    });

    await auditLog(request, 'create_user', 'user', id, { email, role });

    return reply.status(201).send({
      success: true,
      data: { id, email, role },
    });
  });

  // DELETE /api/users/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const storage = getStorage();

    const deleted = await storage.deleteUser(id);
    if (!deleted) {
      throw new NotFoundError('User');
    }

    await auditLog(request, 'delete_user', 'user', id);
    return reply.send({ success: true });
  });
}
