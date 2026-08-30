export type MachineStatus = 'online' | 'offline' | 'error';
export type MiningStatus = 'idle' | 'mining' | 'paused' | 'reducing' | 'stopped' | 'error';
export type WorkloadPolicy = 'conservative' | 'balanced' | 'performance';

export interface GpuInfo {
  index: number;
  name: string;
  vendor: string;
  memoryTotal: number; // MB
  driver?: string;
}

export interface MachineSystemInfo {
  hostname: string;
  os: string;
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  ramBytes: number;
  gpus: GpuInfo[];
  agentVersion: string;
}

export interface Machine {
  id: string;
  machineUid: string;
  name: string;
  hostname: string;
  os: string;
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  ramBytes: number;
  gpus: GpuInfo[];
  agentVersion: string;
  ipAddress: string;
  groupId: string | null;
  status: MachineStatus;
  lastHeartbeat: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface MachineListItem {
  id: string;
  name: string;
  hostname: string;
  os: string;
  status: MachineStatus;
  cpuModel: string;
  gpuCount: number;
  agentVersion: string;
  groupId: string | null;
  groupName: string | null;
  lastHeartbeat: string | null;
}
