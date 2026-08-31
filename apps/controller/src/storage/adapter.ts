import type { MachineConfig, TelemetrySnapshot, WorkloadPolicy, MiningStatus } from '@minefleet/shared-types';

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'viewer';
  totpSecret?: string | null;
  totpEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMachine {
  id: string;
  machineUid: string;
  name: string;
  hostname: string;
  os: string;
  osVersion?: string;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  ramBytes: number;
  gpus: Array<{
    id: string;
    model: string;
    vramBytes: number;
    driverVersion?: string;
  }>;
  agentVersion: string;
  ipAddress?: string;
  groupId?: string | null;
  status: 'online' | 'offline' | 'warning' | 'error';
  lastHeartbeat?: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface StoredCredential {
  machineId: string;
  tokenHash: string;
  issuedAt: string;
  rotatedAt?: string | null;
  revoked: boolean;
}

export interface StoredEnrollmentToken {
  id: string;
  tokenHash: string;
  label?: string | null;
  targetGroupId?: string | null;
  createdBy?: string | null;
  expiresAt: string;
  usedAt?: string | null;
  usedByMachine?: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface MachineState {
  machineId: string;
  cpuPercent: number;
  ramPercent: number;
  ramTotalBytes?: number | null;
  ramUsedBytes?: number | null;
  ramAvailableBytes?: number | null;
  gpuPercent: number;
  cpuTempC: number | null;
  gpuTempC?: number | null;
  hashrate: number;
  miningThreads: number;
  miningStatus: MiningStatus;
  powerWatts?: number | null;
  safetyState: 'normal' | 'throttled' | 'paused_thermal' | 'paused_load';
  workloadLevel?: 'light' | 'normal' | 'heavy' | 'critical';
  minefleetCpuPercent?: number | null;
  otherCpuPercent?: number | null;
  topProcesses?: Array<{
    name: string;
    cpuPercent: number;
    ramBytes: number;
    pid?: number;
    status?: string;
  }>;
  uptimeSeconds?: number;
  recordedAt: string;
}

export interface CompactTelemetryPoint {
  t: number;      // Unix timestamp (epoch ms)
  c: number;      // CPU %
  r: number;      // RAM %
  g: number;      // GPU %
  temp: number;   // Max temp C
  h: number;      // Hashrate H/s
  p?: number;     // Power Watts (optional)
}

export interface QueuedCommand {
  id: string;
  type: 'start' | 'stop' | 'pause' | 'resume' | 'update_config';
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface StoredGroup {
  id: string;
  name: string;
  description?: string | null;
  defaultConfig?: Partial<MachineConfig> | null;
  createdAt: string;
}

export interface PlatformSettings {
  electricityPricePerKwh: number;
  telemetryRetentionDays: number;
  defaultCurrency: string;
}

export interface StoredAuditLog {
  id: string;
  userId?: string | null;
  userEmail?: string | null;
  machineId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export interface StorageAdapter {
  init(): Promise<void>;

  // Users
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserById(id: string): Promise<StoredUser | null>;
  saveUser(user: StoredUser): Promise<void>;
  listUsers(): Promise<StoredUser[]>;
  deleteUser(id: string): Promise<boolean>;

  // Machines
  getMachineById(id: string): Promise<StoredMachine | null>;
  getMachineByUid(uid: string): Promise<StoredMachine | null>;
  saveMachine(machine: StoredMachine): Promise<void>;
  listMachines(): Promise<StoredMachine[]>;
  deleteMachine(id: string): Promise<boolean>;

  // Credentials
  getMachineCredential(machineId: string): Promise<StoredCredential | null>;
  saveMachineCredential(cred: StoredCredential): Promise<void>;
  getMachineIdByTokenHash(tokenHash: string): Promise<string | null>;

  // Configurations
  getMachineConfig(machineId: string): Promise<MachineConfig | null>;
  saveMachineConfig(machineId: string, config: MachineConfig): Promise<void>;

  // Live State
  getMachineState(machineId: string): Promise<MachineState | null>;
  saveMachineState(state: MachineState): Promise<void>;

  // 10-Day Compact History
  appendTelemetryHistory(machineId: string, point: CompactTelemetryPoint, maxAgeDays?: number): Promise<void>;
  getTelemetryHistory(machineId: string, durationMinutes?: number): Promise<CompactTelemetryPoint[]>;

  // Enrollment Tokens
  saveEnrollmentToken(token: StoredEnrollmentToken, ttlSeconds?: number): Promise<void>;
  getEnrollmentTokenByHash(tokenHash: string): Promise<StoredEnrollmentToken | null>;
  getEnrollmentTokenById(id: string): Promise<StoredEnrollmentToken | null>;
  listEnrollmentTokens(): Promise<StoredEnrollmentToken[]>;
  revokeEnrollmentToken(id: string): Promise<boolean>;

  // Command Queue
  pushCommand(machineId: string, command: QueuedCommand): Promise<void>;
  popCommands(machineId: string): Promise<QueuedCommand[]>;

  // Settings
  getSettings(): Promise<PlatformSettings>;
  saveSettings(settings: Partial<PlatformSettings>): Promise<void>;

  // Groups
  getGroup(id: string): Promise<StoredGroup | null>;
  saveGroup(group: StoredGroup): Promise<void>;
  listGroups(): Promise<StoredGroup[]>;
  deleteGroup(id: string): Promise<boolean>;

  // Audit Logs
  logAudit(entry: StoredAuditLog): Promise<void>;
  listAuditLogs(limit?: number, userId?: string): Promise<StoredAuditLog[]>;
}
