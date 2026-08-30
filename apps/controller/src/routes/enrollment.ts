import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import type { JwtPayload } from '../middleware/auth.js';
import * as enrollmentService from '../services/enrollment.service.js';
import { loadConfig } from '../config.js';

export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/enrollment-tokens - create new token
  app.post<{ Body: { label?: string; targetGroupId?: string; expiresInMinutes?: number } }>(
    '/',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const user = (request as any).user as JwtPayload;
      const { label, targetGroupId, expiresInMinutes } = request.body || {};

      const tokenInfo = await enrollmentService.createEnrollmentToken({
        createdBy: user.sub,
        label,
        targetGroupId,
        expiresInMinutes,
      });

      const config = loadConfig();
      const baseUrl = config.controllerUrl || 'https://minefleet.vercel.app';

      await auditLog(request, 'create_enrollment_token', 'enrollment_token', tokenInfo.id);

      return reply.status(201).send({
        success: true,
        data: {
          id: tokenInfo.id,
          token: tokenInfo.rawToken,
          label: tokenInfo.label,
          targetGroupId: tokenInfo.targetGroupId,
          expiresAt: tokenInfo.expiresAt.toISOString(),
          installCommandLinux: `curl -fsSL "${baseUrl}/install.sh?token=${tokenInfo.rawToken}" | bash`,
          installCommandWindows: `powershell -ExecutionPolicy Bypass -c "irm '${baseUrl}/install.ps1?token=${tokenInfo.rawToken}' | iex"`,
        },
      });
    },
  );

  // GET /api/enrollment-tokens - list tokens
  app.get('/', { preHandler: [requireAdmin] }, async (request, reply) => {
    const tokens = await enrollmentService.listEnrollmentTokens();
    return reply.send({ success: true, data: { tokens } });
  });

  // DELETE /api/enrollment-tokens/:id - revoke token
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    await enrollmentService.revokeEnrollmentToken(request.params.id);
    await auditLog(request, 'revoke_enrollment_token', 'enrollment_token', request.params.id);
    return reply.send({ success: true });
  });
}
