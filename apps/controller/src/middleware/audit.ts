import type { FastifyRequest } from 'fastify';
import { getStorage } from '../storage/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { JwtPayload } from './auth.js';
import { randomUUID } from 'node:crypto';

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
    const storage = getStorage();

    await storage.logAudit({
      id: randomUUID(),
      userId: user?.sub || null,
      userEmail: user?.email || null,
      action,
      resourceType,
      resourceId: resourceId || null,
      details,
      ipAddress: request.ip,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, action, resourceType }, 'Failed to write audit log');
  }
}
