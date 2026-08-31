import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import * as machineService from '../services/machine.service.js';
import * as configService from '../services/config.service.js';
import * as enrollmentService from '../services/enrollment.service.js';
import { getStorage } from '../storage/index.js';
import type { MachineConfigUpdate } from '@minefleet/shared-types';
import { UnauthorizedError } from '../utils/errors.js';
import { randomUUID } from 'node:crypto';

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
    const { enrollmentToken, machineUid, systemInfo } = request.body || {};

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

  // POST /api/machines/heartbeat (or /api/agent/heartbeat) - agent sends telemetry & receives commands
  app.post<{
    Body: {
      telemetry: {
        cpuPercent: number;
        ramPercent: number;
        ramTotalBytes?: number | null;
        ramUsedBytes?: number | null;
        ramAvailableBytes?: number | null;
        gpuPercent?: number;
        cpuTempC?: number | null;
        gpuTempC?: number | null;
        hashrate: number;
        miningThreads: number;
        miningStatus: 'idle' | 'mining' | 'paused' | 'stopped' | 'error';
        powerWatts?: number | null;
        safetyState?: 'normal' | 'throttled' | 'paused_thermal' | 'paused_load';
        workloadLevel?: 'light' | 'normal' | 'heavy' | 'critical';
        minefleetCpuPercent?: number | null;
        otherCpuPercent?: number | null;
        topProcesses?: any[];
        uptimeSeconds?: number;
      };
      systemInfo?: any;
      configVersion?: number;
    };
  }>('/heartbeat', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const apiToken = authHeader.substring(7);
    const auth = await machineService.authenticateMachine(apiToken);
    if (!auth) {
      throw new UnauthorizedError('Invalid machine credentials');
    }

    const storage = getStorage();
    const machineId = auth.machineId;
    const body = request.body || ({} as any);
    const tel = body.telemetry || {
      cpuPercent: 0,
      ramPercent: 0,
      gpuPercent: 0,
      cpuTempC: null,
      hashrate: 0,
      miningThreads: 0,
      miningStatus: 'idle',
      safetyState: 'normal',
    };

    // Update heartbeat timestamp & IP
    await machineService.updateMachineHeartbeat(machineId, request.ip);

    // If system info included, update hardware metadata
    if (body.systemInfo) {
      await machineService.updateMachineSystemInfo(machineId, body.systemInfo);
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // 1. Save live snapshot state
    await storage.saveMachineState({
      machineId,
      cpuPercent: tel.cpuPercent || 0,
      ramPercent: tel.ramPercent || 0,
      ramTotalBytes: tel.ramTotalBytes ?? null,
      ramUsedBytes: tel.ramUsedBytes ?? null,
      ramAvailableBytes: tel.ramAvailableBytes ?? null,
      gpuPercent: tel.gpuPercent || 0,
      cpuTempC: tel.cpuTempC ?? null,
      gpuTempC: tel.gpuTempC ?? null,
      hashrate: tel.hashrate || 0,
      miningThreads: tel.miningThreads || 0,
      miningStatus: tel.miningStatus || 'idle',
      powerWatts: tel.powerWatts ?? null,
      safetyState: tel.safetyState || 'normal',
      workloadLevel: tel.workloadLevel || 'light',
      minefleetCpuPercent: tel.minefleetCpuPercent ?? null,
      otherCpuPercent: tel.otherCpuPercent ?? null,
      topProcesses: Array.isArray(tel.topProcesses) ? tel.topProcesses.slice(0, 10) : [],
      uptimeSeconds: tel.uptimeSeconds ?? undefined,
      recordedAt: nowIso,
    });

    // 2. Append compact telemetry point to 10-day history ring buffer
    await storage.appendTelemetryHistory(
      machineId,
      {
        t: now,
        c: Math.round((tel.cpuPercent || 0) * 10) / 10,
        r: Math.round((tel.ramPercent || 0) * 10) / 10,
        g: Math.round((tel.gpuPercent || 0) * 10) / 10,
        temp: tel.cpuTempC ? Math.round(tel.cpuTempC * 10) / 10 : 0,
        h: Math.round((tel.hashrate || 0) * 10) / 10,
        p: tel.powerWatts ? Math.round(tel.powerWatts) : undefined,
      },
      10, // 10 days max retention
    );

    // 3. Retrieve any queued commands for this machine
    const commands = await storage.popCommands(machineId);

    // 4. Retrieve latest config
    const currentConfig = await configService.getMachineConfig(machineId);

    return reply.send({
      success: true,
      data: {
        commands,
        config: (body.configVersion && body.configVersion >= currentConfig.version) ? undefined : currentConfig,
        serverTime: nowIso,
      },
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

  // GET /api/machines/:id/history - get 10-day compact telemetry history
  app.get<{ Params: { id: string }; Querystring: { minutes?: string } }>(
    '/:id/history',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const storage = getStorage();
      const minutes = parseInt((request.query as any)?.minutes || '1440', 10);
      const points = await storage.getTelemetryHistory(request.params.id, minutes);
      return reply.send({ success: true, data: { points, count: points.length } });
    },
  );

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

      await auditLog(request, 'update_config', 'machine_config', request.params.id, request.body as Record<string, unknown>);
      return reply.send({ success: true, data: { config, version } });
    },
  );

  // POST /api/machines/:id/start - start mining
  app.post<{ Params: { id: string } }>('/:id/start', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;

    // Update config miningEnabled = true
    await configService.updateMachineConfig(machineId, { miningEnabled: true });

    // Queue start command
    await storage.pushCommand(machineId, {
      id: randomUUID(),
      type: 'start',
      timestamp: Date.now(),
    });

    await auditLog(request, 'start_mining', 'machine', machineId);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/stop - stop mining
  app.post<{ Params: { id: string } }>('/:id/stop', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;

    // Update config miningEnabled = false
    await configService.updateMachineConfig(machineId, { miningEnabled: false });

    // Queue stop command
    await storage.pushCommand(machineId, {
      id: randomUUID(),
      type: 'stop',
      timestamp: Date.now(),
    });

    await auditLog(request, 'stop_mining', 'machine', machineId);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/pause
  app.post<{ Params: { id: string } }>('/:id/pause', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;

    await storage.pushCommand(machineId, {
      id: randomUUID(),
      type: 'pause',
      timestamp: Date.now(),
    });

    await auditLog(request, 'pause_mining', 'machine', machineId);
    return reply.send({ success: true });
  });

  // POST /api/machines/:id/resume
  app.post<{ Params: { id: string } }>('/:id/resume', { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;

    await storage.pushCommand(machineId, {
      id: randomUUID(),
      type: 'resume',
      timestamp: Date.now(),
    });

    await auditLog(request, 'resume_mining', 'machine', machineId);
    return reply.send({ success: true });
  });

  // DELETE /api/machines/:id
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    await machineService.deleteMachine(request.params.id);
    await auditLog(request, 'delete_machine', 'machine', request.params.id);
    return reply.send({ success: true });
  });
}
