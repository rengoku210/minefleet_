import type { Machine, MachineListItem } from './machine.js';
import type { MachineConfig, MachineConfigUpdate } from './config.js';
import type { TelemetryRecord, MachineStats, MiningSession } from './telemetry.js';

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
}

export interface RefreshResponse {
  accessToken: string;
}

// Enrollment
export interface CreateEnrollmentTokenRequest {
  label?: string;
  targetGroupId?: string | null;
  expiresInMinutes?: number; // default 60
}

export interface EnrollmentTokenResponse {
  id: string;
  token: string; // plaintext, shown once
  label: string | null;
  targetGroupId: string | null;
  expiresAt: string;
  installCommandLinux: string;
  installCommandWindows: string;
}

export interface EnrollmentTokenListItem {
  id: string;
  label: string | null;
  targetGroupId: string | null;
  targetGroupName: string | null;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedByMachine: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface EnrollMachineRequest {
  enrollmentToken: string;
  systemInfo: import('./machine.js').MachineSystemInfo;
  machineUid: string;
}

export interface EnrollMachineResponse {
  machineId: string;
  machineApiToken: string; // plaintext, stored by agent
  config: MachineConfig;
}

// Machines
export interface MachineDetailResponse extends Machine {
  config: MachineConfig;
  groupName: string | null;
  latestTelemetry: TelemetryRecord | null;
}

export interface MachineListResponse {
  machines: MachineListItem[];
  total: number;
}

// Groups
export interface MachineGroup {
  id: string;
  name: string;
  description: string | null;
  defaultConfig: Partial<MachineConfig> | null;
  machineCount: number;
  createdAt: string;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  defaultConfig?: Partial<MachineConfig>;
}

// Schedules
export interface Schedule {
  id: string;
  machineId: string | null;
  groupId: string | null;
  name: string;
  cronExpression: string | null;
  startTime: string;
  endTime: string;
  days: string;
  configOverride: Partial<MachineConfig>;
  enabled: boolean;
  createdAt: string;
}

export interface CreateScheduleRequest {
  machineId?: string;
  groupId?: string;
  name: string;
  startTime: string;
  endTime: string;
  days: string; // 'mon,tue,wed,...'
  configOverride: Partial<MachineConfig>;
  enabled?: boolean;
}

// Settings
export interface GlobalSettings {
  electricityPricePerKwh: number;
  telemetryRetentionDays: number;
  defaultCurrency: string;
}

// Notifications
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical';
export type NotificationType = 
  | 'machine_offline'
  | 'machine_online'
  | 'mining_stopped'
  | 'temp_exceeded'
  | 'agent_error'
  | 'connection_failure'
  | 'config_update_failure';

export interface Notification {
  id: string;
  machineId: string | null;
  severity: NotificationSeverity;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  dismissed: boolean;
  createdAt: string;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Pagination
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
