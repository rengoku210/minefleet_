import { queryOne, query } from '../db/pool.js';
import { NotFoundError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { MachineConfigUpdate } from '@minefleet/shared-types';

const logger = createChildLogger('config');

/** Get machine config */
export async function getMachineConfig(machineId: string) {
  const config = await queryOne(
    'SELECT * FROM machine_configs WHERE machine_id = $1',
    [machineId],
  );
  if (!config) throw new NotFoundError('Machine config');
  return mapConfigRow(config);
}

/** Update machine config - increments version */
export async function updateMachineConfig(
  machineId: string,
  updates: MachineConfigUpdate,
): Promise<{ config: any; version: number }> {
  // Build dynamic SET clause
  const setClauses: string[] = ['version = version + 1', 'updated_at = NOW()'];
  const values: unknown[] = [machineId];
  let paramIndex = 2;

  const fieldMap: Record<string, string> = {
    miningEnabled: 'mining_enabled',
    cpuLimitPercent: 'cpu_limit_percent',
    maxMiningThreads: 'max_mining_threads',
    gpuEnabled: 'gpu_enabled',
    gpuSettings: 'gpu_settings',
    workloadPolicy: 'workload_policy',
    pauseCpuAbove: 'pause_cpu_above',
    reduceCpuAbove: 'reduce_cpu_above',
    resumeCpuBelow: 'resume_cpu_below',
    tempWarningC: 'temp_warning_c',
    tempReduceC: 'temp_reduce_c',
    tempPauseC: 'temp_pause_c',
    tempResumeC: 'temp_resume_c',
    poolConfig: 'pool_config',
    custom: 'custom',
  };

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    if (key in updates) {
      const value = (updates as any)[key];
      if (['gpuSettings', 'poolConfig', 'custom'].includes(key)) {
        setClauses.push(`${dbCol} = $${paramIndex}`);
        values.push(value ? JSON.stringify(value) : null);
      } else {
        setClauses.push(`${dbCol} = $${paramIndex}`);
        values.push(value);
      }
      paramIndex++;
    }
  }

  const result = await queryOne(
    `UPDATE machine_configs SET ${setClauses.join(', ')} WHERE machine_id = $1 RETURNING *`,
    values,
  );

  if (!result) throw new NotFoundError('Machine config');

  const config = mapConfigRow(result);
  logger.info({ machineId, version: config.version }, 'Machine config updated');

  return { config, version: config.version };
}

function mapConfigRow(row: any) {
  return {
    id: row.id,
    machineId: row.machine_id,
    version: row.version,
    miningEnabled: row.mining_enabled,
    cpuLimitPercent: row.cpu_limit_percent,
    maxMiningThreads: row.max_mining_threads,
    gpuEnabled: row.gpu_enabled,
    gpuSettings: row.gpu_settings || [],
    workloadPolicy: row.workload_policy,
    pauseCpuAbove: row.pause_cpu_above,
    reduceCpuAbove: row.reduce_cpu_above,
    resumeCpuBelow: row.resume_cpu_below,
    tempWarningC: row.temp_warning_c,
    tempReduceC: row.temp_reduce_c,
    tempPauseC: row.temp_pause_c,
    tempResumeC: row.temp_resume_c,
    poolConfig: row.pool_config,
    custom: row.custom || {},
    updatedAt: row.updated_at,
  };
}
