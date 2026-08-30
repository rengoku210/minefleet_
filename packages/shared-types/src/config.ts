import type { WorkloadPolicy } from './machine.js';

export interface GpuSettings {
  index: number;
  enabled: boolean;
  powerLimit?: number; // percentage
  tempLimit?: number; // celsius
}

export interface MachineConfig {
  id: string;
  machineId: string;
  version: number;
  miningEnabled: boolean;
  cpuLimitPercent: number; // 0-100
  maxMiningThreads: number | null;
  gpuEnabled: boolean;
  gpuSettings: GpuSettings[];
  workloadPolicy: WorkloadPolicy;
  pauseCpuAbove: number;
  reduceCpuAbove: number;
  resumeCpuBelow: number;
  tempWarningC: number;
  tempReduceC: number;
  tempPauseC: number;
  tempResumeC: number;
  poolConfig: PoolConfig | null;
  custom: Record<string, unknown>;
  updatedAt: string;
}

export interface MachineConfigUpdate {
  miningEnabled?: boolean;
  cpuLimitPercent?: number;
  maxMiningThreads?: number | null;
  gpuEnabled?: boolean;
  gpuSettings?: GpuSettings[];
  workloadPolicy?: WorkloadPolicy;
  pauseCpuAbove?: number;
  reduceCpuAbove?: number;
  resumeCpuBelow?: number;
  tempWarningC?: number;
  tempReduceC?: number;
  tempPauseC?: number;
  tempResumeC?: number;
  poolConfig?: PoolConfig | null;
  custom?: Record<string, unknown>;
}

export interface PoolConfig {
  poolUrl: string;
  walletAddress: string;
  workerId?: string;
  password?: string;
}

export interface GroupConfig {
  id: string;
  groupId: string;
  version: number;
  config: Partial<MachineConfig>;
  updatedAt: string;
}

/** Default safe configuration for new machines */
export const DEFAULT_MACHINE_CONFIG: Omit<MachineConfig, 'id' | 'machineId' | 'version' | 'updatedAt'> = {
  miningEnabled: false,
  cpuLimitPercent: 20,
  maxMiningThreads: null,
  gpuEnabled: false,
  gpuSettings: [],
  workloadPolicy: 'conservative',
  pauseCpuAbove: 90,
  reduceCpuAbove: 75,
  resumeCpuBelow: 60,
  tempWarningC: 75,
  tempReduceC: 80,
  tempPauseC: 85,
  tempResumeC: 70,
  poolConfig: null,
  custom: {},
};
