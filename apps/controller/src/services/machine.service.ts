import { getStorage } from '../storage/index.js';
import { hashToken } from '../utils/crypto.js';
import { NotFoundError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { StoredMachine, MachineState } from '../storage/adapter.js';

const logger = createChildLogger('machine-service');

/** Authenticate a machine by API token, returns machine ID & UID */
export async function authenticateMachine(apiToken: string): Promise<{ machineId: string; machineUid: string } | null> {
  const storage = getStorage();
  const tokenHash = hashToken(apiToken);
  const machines = await storage.listMachines();

  for (const m of machines) {
    const cred = await storage.getMachineCredential(m.id);
    if (cred && cred.tokenHash === tokenHash && !cred.revoked) {
      return { machineId: m.id, machineUid: m.machineUid };
    }
  }

  return null;
}

/** Get all machines with calculated online status and group name */
export async function listMachines() {
  const storage = getStorage();
  const machines = await storage.listMachines();
  const groups = await storage.listGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  const now = Date.now();
  const result = [];

  for (const m of machines) {
    const lastSeenMs = m.lastHeartbeat ? new Date(m.lastHeartbeat).getTime() : 0;
    const isOnline = lastSeenMs > 0 && (now - lastSeenMs) < 60000; // 60s timeout
    const currentStatus = isOnline ? 'online' : 'offline';

    // Update status in storage if it changed
    if (m.status !== currentStatus) {
      m.status = currentStatus;
      await storage.saveMachine(m);
    }

    result.push({
      id: m.id,
      name: m.name,
      hostname: m.hostname,
      os: m.os,
      status: m.status,
      cpu_model: m.cpuModel,
      gpu_count: m.gpus ? m.gpus.length : 0,
      agent_version: m.agentVersion,
      group_id: m.groupId || null,
      group_name: m.groupId ? groupMap.get(m.groupId) || null : null,
      last_heartbeat: m.lastHeartbeat || null,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Get a single machine with full details */
export async function getMachine(machineId: string) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError('Machine');

  let groupName: string | null = null;
  if (machine.groupId) {
    const group = await storage.getGroup(machine.groupId);
    groupName = group?.name || null;
  }

  const config = await storage.getMachineConfig(machineId);
  const latestTelemetry = await storage.getMachineState(machineId);

  // Compute online status
  const lastSeenMs = machine.lastHeartbeat ? new Date(machine.lastHeartbeat).getTime() : 0;
  const isOnline = lastSeenMs > 0 && (Date.now() - lastSeenMs) < 60000;
  machine.status = isOnline ? 'online' : 'offline';

  return {
    machine: {
      ...machine,
      group_name: groupName,
      cpu_model: machine.cpuModel,
      cpu_cores: machine.cpuCores,
      cpu_threads: machine.cpuThreads,
      ram_bytes: machine.ramBytes,
      last_heartbeat: machine.lastHeartbeat,
    },
    config,
    latestTelemetry,
  };
}

/** Update machine's system info */
export async function updateMachineSystemInfo(
  machineId: string,
  info: {
    hostname: string;
    os: string;
    osVersion: string;
    cpuModel: string;
    cpuCores: number;
    cpuThreads: number;
    ramBytes: number;
    gpus: any[];
    agentVersion: string;
  },
): Promise<void> {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) return;

  machine.hostname = info.hostname;
  machine.os = info.os;
  machine.osVersion = info.osVersion;
  machine.cpuModel = info.cpuModel;
  machine.cpuCores = info.cpuCores;
  machine.cpuThreads = info.cpuThreads;
  machine.ramBytes = info.ramBytes;
  machine.gpus = info.gpus || [];
  machine.agentVersion = info.agentVersion;
  machine.updatedAt = new Date().toISOString();

  await storage.saveMachine(machine);
}

/** Update machine status and heartbeat */
export async function updateMachineHeartbeat(
  machineId: string,
  ipAddress?: string,
): Promise<void> {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) return;

  machine.status = 'online';
  machine.lastHeartbeat = new Date().toISOString();
  if (ipAddress) machine.ipAddress = ipAddress;
  machine.updatedAt = new Date().toISOString();

  await storage.saveMachine(machine);
}

/** Mark machine as offline */
export async function markMachineOffline(machineId: string): Promise<void> {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) return;

  machine.status = 'offline';
  machine.updatedAt = new Date().toISOString();
  await storage.saveMachine(machine);
}

/** Delete a machine */
export async function deleteMachine(machineId: string): Promise<void> {
  const storage = getStorage();
  const deleted = await storage.deleteMachine(machineId);
  if (!deleted) {
    throw new NotFoundError('Machine');
  }
  logger.info({ machineId }, 'Machine deleted');
}

/** Update machine name */
export async function updateMachineName(machineId: string, name: string): Promise<void> {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError('Machine');

  machine.name = name;
  machine.updatedAt = new Date().toISOString();
  await storage.saveMachine(machine);
}

/** Move machine to a group */
export async function updateMachineGroup(machineId: string, groupId: string | null): Promise<void> {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError('Machine');

  if (groupId) {
    const group = await storage.getGroup(groupId);
    if (!group) throw new NotFoundError('Machine group');
  }

  machine.groupId = groupId;
  machine.updatedAt = new Date().toISOString();
  await storage.saveMachine(machine);
}
