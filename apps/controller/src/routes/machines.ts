import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import * as machineService from '../services/machine.service.js';
import * as configService from '../services/config.service.js';
import * as enrollmentService from '../services/enrollment.service.js';
import { getConnectionByMachineId } from '../ws/connections.js';
import type { MachineConfigUpdate } from '@minefleet/shared-types';

export async function machineRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/machines/enroll - public endpoint for agent enrollment
  app.post<{
    Body: {
      enrollmentToken: string;
      machineUid: string;
      systemInfo: any;
    };
  }>('/enroll', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { enrollmentToken, machineUid, systemInfo } = request.body;

    if (!enrollmentToken || !machineUid || !systemInfo) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'enrollmentToken, machineUid, and systemInfo are required' },
      });
    }

    const result = await enrollmentService.enrollMachine(
      enrollmentToken,
      machineUid,
      systemInfo,
      request.ip,
    );

    return reply.status(201).send({
      success: true,
      data: result,
    });
  });

  // GET /api/machines - list all machines
  app.get('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const machines = await machineService.listMachines();
    return reply.send({ success: true, data: { machines, total: machines.length } });
  });

  // GET /api/machines/:id - get machine details
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const data = await machineService.getMachine(request.params.id);
    return reply.send({ success: true, data });
  });

  // PATCH /api/machines/:id - update machine name/group
  app.patch<{ Params: { id: string }; Body: { name?: string; groupId?: string | null } }>(
    '/:id',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { name, groupId } = request.body || {};

      if (name !== undefined) {
        await machineService.updateMachineName(request.params.id, name);
      }
      if (groupId !== undefined) {
        await machineService.updateMachineGroup(request.params.id, groupId);
      }

      await auditLog(request, 'update_machine', 'machine', request.params.id, { name, groupId });
      return reply.send({ success: true });
    },
  );

  // PATCH /api/machines/:id/config - update machine config
  app.patch<{ Params: { id: string }; Body: MachineConfigUpdate }>(
    '/:id/config',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { config, version } = await configService.updateMachineConfig(
        request.params.id,
        request.body as MachineConfigUpdate,
      );

      // Push config to connected agent
      const conn = getConnectionByMachineId(request.params.id);
      if (conn) {
        conn.send(JSON.stringify({
          type: 'ctrl:config_update',
          timestamp: Date.now(),
          payload: { config, version },
        }));
      }

      await auditLog(request, 'update_config', 'machine_config', request.params.id, request.body as Record<string, unknown>);
      return reply.send({ success: true, data: { config, version } });
    },
  );

  // POST /api/machines/:id/start - start mining
  app.post<{ Params: { id: string } }>('/:id/start', { preHandler: [requireAdmin] }, async (request, reply) => {
    const conn = getConnectionByMachineId(request.params.id);
    if (!conn) {
      return reply.status(404).send({ success: false, error: { code: 'MACHINE_OFFLINE', message: 'Machine is not connected' } });
    }
    conn.send(JSON.stringify({ type: 'ctrl:command', timestamp: Date.now(), payload: { action: 'start' } }));
    await auditLog(request, 'start_mining', 'machine', request.params.id);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/stop
  app.post<{ Params: { id: string } }>('/:id/stop', { preHandler: [requireAdmin] }, async (request, reply) => {
    const conn = getConnectionByMachineId(request.params.id);
    if (!conn) {
      return reply.status(404).send({ success: false, error: { code: 'MACHINE_OFFLINE', message: 'Machine is not connected' } });
    }
    conn.send(JSON.stringify({ type: 'ctrl:command', timestamp: Date.now(), payload: { action: 'stop' } }));
    await auditLog(request, 'stop_mining', 'machine', request.params.id);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/pause
  app.post<{ Params: { id: string } }>('/:id/pause', { preHandler: [requireAdmin] }, async (request, reply) => {
    const conn = getConnectionByMachineId(request.params.id);
    if (!conn) {
      return reply.status(404).send({ success: false, error: { code: 'MACHINE_OFFLINE', message: 'Machine is not connected' } });
    }
    conn.send(JSON.stringify({ type: 'ctrl:command', timestamp: Date.now(), payload: { action: 'pause' } }));
    await auditLog(request, 'pause_mining', 'machine', request.params.id);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/resume
  app.post<{ Params: { id: string } }>('/:id/resume', { preHandler: [requireAdmin] }, async (request, reply) => {
    const conn = getConnectionByMachineId(request.params.id);
    if (!conn) {
      return reply.status(404).send({ success: false, error: { code: 'MACHINE_OFFLINE', message: 'Machine is not connected' } });
    }
    conn.send(JSON.stringify({ type: 'ctrl:command', timestamp: Date.now(), payload: { action: 'resume' } }));
    await auditLog(request, 'resume_mining', 'machine', request.params.id);
    return reply.send({ success: true });
  });

  // DELETE /api/machines/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    await machineService.deleteMachine(request.params.id);
    await auditLog(request, 'delete_machine', 'machine', request.params.id);
    return reply.send({ success: true });
  });
}
