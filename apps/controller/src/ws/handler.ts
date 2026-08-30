import type { FastifyRequest } from 'fastify';
import type { WebSocket as WSWebSocket } from '@fastify/websocket';
import { createChildLogger } from '../utils/logger.js';
import { authenticateMachine, updateMachineHeartbeat, updateMachineSystemInfo } from '../services/machine.service.js';
import { getMachineConfig } from '../services/config.service.js';
import { registerConnection, removeConnection, updateHeartbeat } from './connections.js';
import { query } from '../db/pool.js';
import type { WSMessage, AgentAuthPayload, AgentHeartbeatPayload } from '@minefleet/protocol';
import type { TelemetrySnapshot, MachineSystemInfo } from '@minefleet/shared-types';

const logger = createChildLogger('websocket');

export function wsHandler(socket: WSWebSocket, request: FastifyRequest): void {
  logger.info({ ip: request.ip }, 'WebSocket connection received');

  let machineId: string | null = null;
  let authenticated = false;

  socket.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const msg = JSON.parse(data.toString()) as WSMessage;

      switch (msg.type) {
        case 'agent:auth': {
          const payload = msg.payload as AgentAuthPayload;
          const result = await authenticateMachine(payload.apiToken);

          if (!result) {
            socket.send(JSON.stringify({
              type: 'ctrl:auth_result',
              timestamp: Date.now(),
              payload: { success: false, error: 'Invalid credentials' },
            }));
            socket.close(4001, 'Authentication failed');
            return;
          }

          machineId = result.machineId;
          authenticated = true;
          registerConnection(machineId, result.machineUid, socket as any);
          await updateMachineHeartbeat(machineId, request.ip);

          socket.send(JSON.stringify({
            type: 'ctrl:auth_result',
            timestamp: Date.now(),
            payload: { success: true, machineId },
          }));

          // Send current config
          try {
            const config = await getMachineConfig(machineId);
            socket.send(JSON.stringify({
              type: 'ctrl:config_update',
              timestamp: Date.now(),
              payload: { config, version: config.version },
            }));
          } catch (err) {
            logger.error({ err, machineId }, 'Failed to send initial config');
          }

          logger.info({ machineId, ip: request.ip }, 'Agent authenticated');
          break;
        }

        case 'agent:heartbeat': {
          if (!authenticated || !machineId) return;
          const payload = msg.payload as AgentHeartbeatPayload;
          updateHeartbeat(machineId, payload.configVersion);
          await updateMachineHeartbeat(machineId, request.ip);
          break;
        }

        case 'agent:telemetry': {
          if (!authenticated || !machineId) return;
          const telemetry = msg.payload as TelemetrySnapshot;
          try {
            await query(
              `INSERT INTO telemetry (machine_id, cpu_percent, ram_percent, gpu_percent, cpu_temp_c, gpu_temp_c, hashrate, mining_threads, mining_status, power_watts)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                machineId,
                telemetry.cpuPercent,
                telemetry.ramPercent,
                telemetry.gpuPercent,
                telemetry.cpuTempC,
                telemetry.gpuTempC,
                telemetry.hashrate,
                telemetry.miningThreads,
                telemetry.miningStatus,
                telemetry.powerWatts,
              ],
            );
          } catch (err) {
            logger.error({ err, machineId }, 'Failed to insert telemetry');
          }
          break;
        }

        case 'agent:system_info': {
          if (!authenticated || !machineId) return;
          const systemInfo = msg.payload as MachineSystemInfo;
          await updateMachineSystemInfo(machineId, systemInfo);
          break;
        }

        case 'agent:mining_event': {
          if (!authenticated || !machineId) return;
          logger.info({ machineId, event: msg.payload }, 'Mining event');
          break;
        }

        case 'agent:config_ack': {
          if (!authenticated || !machineId) return;
          logger.info({ machineId, ack: msg.payload }, 'Config acknowledged');
          break;
        }

        case 'agent:log': {
          if (!authenticated || !machineId) return;
          const logPayload = msg.payload as { level: string; component: string; message: string };
          logger.child({ machineId, agentComponent: logPayload.component })[
            logPayload.level === 'error' ? 'error' :
            logPayload.level === 'warn' ? 'warn' :
            logPayload.level === 'debug' ? 'debug' : 'info'
          ](logPayload.message);
          break;
        }

        default:
          logger.warn({ type: msg.type }, 'Unknown message type');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to process WebSocket message');
    }
  });

  socket.on('close', () => {
    if (machineId) {
      removeConnection(machineId);
      logger.info({ machineId, ip: request.ip }, 'Agent disconnected');
    }
  });

  socket.on('error', (err: Error) => {
    logger.error({ err: err.message, machineId }, 'WebSocket error');
  });
}
