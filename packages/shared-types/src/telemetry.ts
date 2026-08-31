import type { MiningStatus } from './machine.js';

export type WorkloadLevel = 'light' | 'normal' | 'heavy' | 'critical';
export type SafetyState = 'normal' | 'throttled' | 'paused_thermal' | 'paused_load';

export interface ProcessItem {
  name: string;
  cpuPercent: number;
  ramBytes: number;
  pid?: number;
  status?: string;
}

export interface TelemetrySnapshot {
  cpuPercent: number;
  ramPercent: number;
  ramTotalBytes?: number | null;
  ramUsedBytes?: number | null;
  ramAvailableBytes?: number | null;
  gpuPercent: number | null;
  cpuTempC: number | null;
  gpuTempC: number | null;
  hashrate: number | null;
  miningThreads: number;
  miningStatus: MiningStatus;
  powerWatts: number | null;
  safetyState?: SafetyState;
  workloadLevel?: WorkloadLevel;
  minefleetCpuPercent?: number | null;
  otherCpuPercent?: number | null;
  topProcesses?: ProcessItem[];
  uptimeSeconds?: number;
}

export interface TelemetryRecord extends TelemetrySnapshot {
  id: string;
  machineId: string;
  recordedAt: string;
}

export interface MachineStats {
  machineId: string;
  period: 'hour' | 'day' | 'week' | 'month';
  avgCpuPercent: number;
  avgGpuPercent: number | null;
  avgHashrate: number | null;
  avgTempC: number | null;
  maxTempC: number | null;
  miningUptimeSeconds: number;
  miningInterruptions: number;
  estimatedPowerKwh: number | null;
  estimatedCostUsd: number | null;
}

export interface MiningSession {
  id: string;
  machineId: string;
  backend: string;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  avgHashrate: number | null;
  avgCpuPercent: number | null;
  avgGpuPercent: number | null;
}
