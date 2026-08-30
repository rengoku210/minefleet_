import type { FastifyRequest } from 'fastify';
import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';
import type { JwtPayload } from './auth.js';

const logger = createChildLogger('audit');

export async function auditLog(
  request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const user = (request as any).user as JwtPayload | undefined;
    const ip = request.ip;

    await query(
      `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
      [user?.sub || null, action, resourceType, resourceId || null, details ? JSON.stringify(details) : null, ip],
    );
  } catch (err) {
    logger.error({ err, action, resourceType }, 'Failed to write audit log');
  }
}
