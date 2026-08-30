import { getStorage } from '../storage/index.js';
import { NotFoundError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { MachineConfig, MachineConfigUpdate } from '@minefleet/shared-types';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';
import { randomUUID } from 'node:crypto';

const logger = createChildLogger('config-service');

/** Get machine config */
export async function getMachineConfig(machineId: string): Promise<MachineConfig> {
  const storage = getStorage();
  const config = await storage.getMachineConfig(machineId);
  if (!config) {
    // Generate default config if missing
    const def: MachineConfig = {
      ...DEFAULT_MACHINE_CONFIG,
      id: randomUUID(),
      machineId,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveMachineConfig(machineId, def);
    return def;
  }
  return config;
}

/** Update machine config - increments version and queues command */
export async function updateMachineConfig(
  machineId: string,
  updates: MachineConfigUpdate,
): Promise<{ config: MachineConfig; version: number }> {
  const storage = getStorage();
  const current = await getMachineConfig(machineId);

  const updatedConfig: MachineConfig = {
    ...current,
    ...updates,
    version: (current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
  };

  await storage.saveMachineConfig(machineId, updatedConfig);

  // Queue command for agent
  await storage.pushCommand(machineId, {
    id: randomUUID(),
    type: 'update_config',
    payload: { config: updatedConfig },
    timestamp: Date.now(),
  });

  logger.info({ machineId, version: updatedConfig.version }, 'Machine config updated');

  return { config: updatedConfig, version: updatedConfig.version };
}
