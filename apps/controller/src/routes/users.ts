import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { query, queryOne, queryAll } from '../db/pool.js';
import { hashPassword } from '../utils/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users - list all users
  app.get('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const users = await queryAll(
      'SELECT id, email, role, totp_enabled, created_at, updated_at FROM users ORDER BY created_at DESC',
    );
    return reply.send({ success: true, data: { users } });
  });

  // POST /api/users - create user
  app.post<{ Body: { email: string; password: string; role?: string } }>('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { email, password, role = 'viewer' } = request.body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }
    if (!['admin', 'viewer'].includes(role)) {
      throw new ValidationError('Role must be admin or viewer');
    }
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const result = await queryOne<{ id: string }>(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id`,
      [email, passwordHash, role],
    );

    await auditLog(request, 'create_user', 'user', result!.id, { email, role });

    return reply.status(201).send({
      success: true,
      data: { id: result!.id, email, role },
    });
  });

  // DELETE /api/users/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    
    const result = await query('DELETE FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    await auditLog(request, 'delete_user', 'user', id);

    return reply.send({ success: true });
  });
}
