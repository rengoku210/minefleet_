import type { MachineSystemInfo, MiningStatus } from '@minefleet/shared-types';
import type { MachineConfig } from '@minefleet/shared-types';
import type { TelemetrySnapshot } from '@minefleet/shared-types';

// Base message envelope
export interface WSMessage<T extends string = string, P = unknown> {
  type: T;
  id?: string;
  timestamp: number;
  payload: P;
}

// ============= Agent -> Controller Messages =============

export const AGENT_AUTH = 'agent:auth' as const;
export const AGENT_HEARTBEAT = 'agent:heartbeat' as const;
export const AGENT_TELEMETRY = 'agent:telemetry' as const;
export const AGENT_SYSTEM_INFO = 'agent:system_info' as const;
export const AGENT_MINING_EVENT = 'agent:mining_event' as const;
export const AGENT_CONFIG_ACK = 'agent:config_ack' as const;
export const AGENT_LOG = 'agent:log' as const;

export interface AgentAuthPayload {
  machineUid: string;
  apiToken: string;
  protocolVersion: string;
  agentVersion: string;
}

export interface AgentHeartbeatPayload {
  uptime: number; // seconds
  configVersion: number;
}

export interface AgentMiningEventPayload {
  event: 'started' | 'stopped' | 'paused' | 'resumed' | 'reduced' | 'error';
  reason?: string;
  details?: Record<string, unknown>;
}

export interface AgentConfigAckPayload {
  configVersion: number;
  success: boolean;
  error?: string;
}

export interface AgentLogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export type AgentAuthMessage = WSMessage<typeof AGENT_AUTH, AgentAuthPayload>;
export type AgentHeartbeatMessage = WSMessage<typeof AGENT_HEARTBEAT, AgentHeartbeatPayload>;
export type AgentTelemetryMessage = WSMessage<typeof AGENT_TELEMETRY, TelemetrySnapshot>;
export type AgentSystemInfoMessage = WSMessage<typeof AGENT_SYSTEM_INFO, MachineSystemInfo>;
export type AgentMiningEventMessage = WSMessage<typeof AGENT_MINING_EVENT, AgentMiningEventPayload>;
export type AgentConfigAckMessage = WSMessage<typeof AGENT_CONFIG_ACK, AgentConfigAckPayload>;
export type AgentLogMessage = WSMessage<typeof AGENT_LOG, AgentLogPayload>;

export type AgentMessage = 
  | AgentAuthMessage
  | AgentHeartbeatMessage
  | AgentTelemetryMessage
  | AgentSystemInfoMessage
  | AgentMiningEventMessage
  | AgentConfigAckMessage
  | AgentLogMessage;

// ============= Controller -> Agent Messages =============

export const CTRL_AUTH_RESULT = 'ctrl:auth_result' as const;
export const CTRL_CONFIG_UPDATE = 'ctrl:config_update' as const;
export const CTRL_COMMAND = 'ctrl:command' as const;
export const CTRL_PING = 'ctrl:ping' as const;
export const CTRL_UPDATE_AVAILABLE = 'ctrl:update_available' as const;

export interface CtrlAuthResultPayload {
  success: boolean;
  error?: string;
  machineId?: string;
}

export interface CtrlConfigUpdatePayload {
  config: MachineConfig;
  version: number;
}

export type MiningCommand = 'start' | 'stop' | 'pause' | 'resume';

export interface CtrlCommandPayload {
  action: MiningCommand;
}

export interface CtrlUpdateAvailablePayload {
  version: string;
  downloadUrl: string;
  checksum: string;
}

export type CtrlAuthResultMessage = WSMessage<typeof CTRL_AUTH_RESULT, CtrlAuthResultPayload>;
export type CtrlConfigUpdateMessage = WSMessage<typeof CTRL_CONFIG_UPDATE, CtrlConfigUpdatePayload>;
export type CtrlCommandMessage = WSMessage<typeof CTRL_COMMAND, CtrlCommandPayload>;
export type CtrlPingMessage = WSMessage<typeof CTRL_PING, Record<string, never>>;
export type CtrlUpdateAvailableMessage = WSMessage<typeof CTRL_UPDATE_AVAILABLE, CtrlUpdateAvailablePayload>;

export type ControllerMessage =
  | CtrlAuthResultMessage
  | CtrlConfigUpdateMessage
  | CtrlCommandMessage
  | CtrlPingMessage
  | CtrlUpdateAvailableMessage;

// ============= Message Constructors =============

let messageCounter = 0;

export function createMessage<T extends string, P>(type: T, payload: P): WSMessage<T, P> {
  return {
    type,
    id: `msg_${Date.now()}_${++messageCounter}`,
    timestamp: Date.now(),
    payload,
  };
}

// ============= Type Guards =============

export function isAgentMessage(msg: WSMessage): msg is AgentMessage {
  return msg.type.startsWith('agent:');
}

export function isControllerMessage(msg: WSMessage): msg is ControllerMessage {
  return msg.type.startsWith('ctrl:');
}

// ============= Constants =============

export const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
export const TELEMETRY_INTERVAL_MS = 10_000; // 10 seconds
export const PING_INTERVAL_MS = 60_000; // 60 seconds
export const PING_TIMEOUT_MS = 90_000; // 90 seconds
export const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds without heartbeat

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]; // exponential backoff, cap at 30s
