import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { MachineConfig } from '@minefleet/shared-types';

export interface AgentLocalConfig {
  machineId: string;
  machineUid: string;
  controllerUrl: string;
  apiToken: string;
  lastConfig: MachineConfig | null;
  lastConfigVersion: number;
}

function getConfigDir(): string {
  if (platform() === 'win32') {
    return join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MineFleet');
  }
  return '/var/lib/minefleet';
}

function getConfigPath(): string {
  return join(getConfigDir(), 'agent.json');
}

export function loadLocalConfig(): AgentLocalConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as AgentLocalConfig;
  } catch {
    return null;
  }
}

export function saveLocalConfig(config: AgentLocalConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getControllerUrl(): string {
  // From env (set by installer) or from saved config
  if (process.env.AGENT_CONTROLLER_URL) return process.env.AGENT_CONTROLLER_URL;
  const config = loadLocalConfig();
  if (config?.controllerUrl) return config.controllerUrl;
  throw new Error('Controller URL not configured. Run the installer first.');
}

export function getAgentVersion(): string {
  return '0.1.0';
}
