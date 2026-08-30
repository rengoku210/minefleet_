import { queryOne, queryAll, query } from '../db/pool.js';
import { hashToken } from '../utils/crypto.js';
import { NotFoundError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('machine');

/** Authenticate a machine by API token, returns machine ID */
export async function authenticateMachine(apiToken: string): Promise<{ machineId: string; machineUid: string } | null> {
  const tokenHash = hashToken(apiToken);
  const result = await queryOne<{ machine_id: string; machine_uid: string }>(
    `SELECT mc.machine_id, m.machine_uid
     FROM machine_credentials mc
     JOIN machines m ON m.id = mc.machine_id
     WHERE mc.token_hash = $1 AND mc.revoked = false`,
    [tokenHash],
  );
  return result ? { machineId: result.machine_id, machineUid: result.machine_uid } : null;
}

/** Get all machines with optional group info */
export async function listMachines() {
  return queryAll(
    `SELECT m.id, m.name, m.hostname, m.os, m.status, m.cpu_model,
            jsonb_array_length(COALESCE(m.gpus, '[]'::jsonb)) as gpu_count,
            m.agent_version, m.group_id, mg.name as group_name,
            m.last_heartbeat
     FROM machines m
     LEFT JOIN machine_groups mg ON mg.id = m.group_id
     ORDER BY m.name ASC`,
  );
}

/** Get a single machine with full details */
export async function getMachine(machineId: string) {
  const machine = await queryOne(
    `SELECT m.*, mg.name as group_name
     FROM machines m
     LEFT JOIN machine_groups mg ON mg.id = m.group_id
     WHERE m.id = $1`,
    [machineId],
  );
  if (!machine) throw new NotFoundError('Machine');

  const config = await queryOne(
    'SELECT * FROM machine_configs WHERE machine_id = $1',
    [machineId],
  );

  const latestTelemetry = await queryOne(
    'SELECT * FROM telemetry WHERE machine_id = $1 ORDER BY recorded_at DESC LIMIT 1',
    [machineId],
  );

  return { machine, config, latestTelemetry };
}

/** Update machine's system info (called when agent reconnects) */
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
  await query(
    `UPDATE machines SET
      hostname = $2, os = $3, os_version = $4,
      cpu_model = $5, cpu_cores = $6, cpu_threads = $7,
      ram_bytes = $8, gpus = $9, agent_version = $10,
      updated_at = NOW()
     WHERE id = $1`,
    [
      machineId,
      info.hostname, info.os, info.osVersion,
      info.cpuModel, info.cpuCores, info.cpuThreads,
      info.ramBytes, JSON.stringify(info.gpus), info.agentVersion,
    ],
  );
}

/** Update machine status and heartbeat */
export async function updateMachineHeartbeat(
  machineId: string,
  ipAddress?: string,
): Promise<void> {
  await query(
    `UPDATE machines SET
      status = 'online',
      last_heartbeat = NOW(),
      ip_address = COALESCE($2, ip_address),
      updated_at = NOW()
     WHERE id = $1`,
    [machineId, ipAddress || null],
  );
}

/** Mark machine as offline */
export async function markMachineOffline(machineId: string): Promise<void> {
  await query(
    "UPDATE machines SET status = 'offline', updated_at = NOW() WHERE id = $1",
    [machineId],
  );
}

/** Delete a machine and all associated data (cascades via FK) */
export async function deleteMachine(machineId: string): Promise<void> {
  const result = await query('DELETE FROM machines WHERE id = $1', [machineId]);
  if (result.rowCount === 0) {
    throw new NotFoundError('Machine');
  }
  logger.info({ machineId }, 'Machine deleted');
}

/** Update machine name */
export async function updateMachineName(machineId: string, name: string): Promise<void> {
  const result = await query(
    'UPDATE machines SET name = $2, updated_at = NOW() WHERE id = $1',
    [machineId, name],
  );
  if (result.rowCount === 0) throw new NotFoundError('Machine');
}

/** Move machine to a group */
export async function updateMachineGroup(machineId: string, groupId: string | null): Promise<void> {
  if (groupId) {
    const group = await queryOne('SELECT id FROM machine_groups WHERE id = $1', [groupId]);
    if (!group) throw new NotFoundError('Machine group');
  }
  await query(
    'UPDATE machines SET group_id = $2, updated_at = NOW() WHERE id = $1',
    [machineId, groupId],
  );
}
