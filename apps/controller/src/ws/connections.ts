import type { WebSocket } from 'ws';
import { createChildLogger } from '../utils/logger.js';
import { markMachineOffline } from '../services/machine.service.js';
import { OFFLINE_THRESHOLD_MS } from '@minefleet/protocol';

const logger = createChildLogger('connections');

interface AgentConnection {
  socket: WebSocket;
  machineId: string;
  machineUid: string;
  lastHeartbeat: number;
  configVersion: number;
}

const connections = new Map<string, AgentConnection>(); // machineId -> connection
let offlineCheckInterval: ReturnType<typeof setInterval> | null = null;

export function initConnectionRegistry(): void {
  // Check for offline machines every 30 seconds
  offlineCheckInterval = setInterval(checkOfflineMachines, 30_000);
  logger.info('Connection registry initialized');
}

export function destroyConnectionRegistry(): void {
  if (offlineCheckInterval) {
    clearInterval(offlineCheckInterval);
    offlineCheckInterval = null;
  }
  connections.clear();
}

export function registerConnection(
  machineId: string,
  machineUid: string,
  socket: WebSocket,
): void {
  // Close existing connection if any
  const existing = connections.get(machineId);
  if (existing) {
    logger.warn({ machineId }, 'Replacing existing connection');
    try {
      existing.socket.close();
    } catch {
      // ignore
    }
  }

  connections.set(machineId, {
    socket,
    machineId,
    machineUid,
    lastHeartbeat: Date.now(),
    configVersion: 0,
  });

  logger.info({ machineId, machineUid, totalConnections: connections.size }, 'Agent connected');
}

export function removeConnection(machineId: string): void {
  connections.delete(machineId);
  logger.info({ machineId, totalConnections: connections.size }, 'Agent disconnected');
}

export function updateHeartbeat(machineId: string, configVersion: number): void {
  const conn = connections.get(machineId);
  if (conn) {
    conn.lastHeartbeat = Date.now();
    conn.configVersion = configVersion;
  }
}

export function getConnectionByMachineId(machineId: string): WebSocket | null {
  return connections.get(machineId)?.socket || null;
}

export function getAllConnections(): Map<string, AgentConnection> {
  return connections;
}

export function getOnlineMachineIds(): string[] {
  return Array.from(connections.keys());
}

export function getConnectionCount(): number {
  return connections.size;
}

async function checkOfflineMachines(): Promise<void> {
  const now = Date.now();
  for (const [machineId, conn] of connections) {
    if (now - conn.lastHeartbeat > OFFLINE_THRESHOLD_MS) {
      logger.warn({ machineId, lastHeartbeat: conn.lastHeartbeat }, 'Machine heartbeat timeout');
      try {
        conn.socket.close();
      } catch {
        // ignore
      }
      connections.delete(machineId);
      try {
        await markMachineOffline(machineId);
      } catch (err) {
        logger.error({ err, machineId }, 'Failed to mark machine offline');
      }
    }
  }
}
