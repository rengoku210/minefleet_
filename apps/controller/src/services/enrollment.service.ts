import { getStorage } from '../storage/index.js';
import { generateToken, hashToken } from '../utils/crypto.js';
import { NotFoundError, ValidationError, UnauthorizedError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { MachineConfig } from '@minefleet/shared-types';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';
import type { StoredEnrollmentToken, StoredMachine, StoredCredential } from '../storage/adapter.js';
import { randomUUID } from 'node:crypto';

const logger = createChildLogger('enrollment-service');

export interface CreateTokenOptions {
  createdBy: string;
  label?: string;
  targetGroupId?: string | null;
  expiresInMinutes?: number;
}

export interface TokenInfo {
  id: string;
  rawToken: string;
  label: string | null;
  targetGroupId: string | null;
  expiresAt: Date;
}

/** Create a new enrollment token */
export async function createEnrollmentToken(options: CreateTokenOptions): Promise<TokenInfo> {
  const storage = getStorage();
  const {
    createdBy,
    label = null,
    targetGroupId = null,
    expiresInMinutes = 60,
  } = options;

  if (targetGroupId) {
    const group = await storage.getGroup(targetGroupId);
    if (!group) {
      throw new NotFoundError('Machine group');
    }
  }

  const rawToken = generateToken('enroll');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const tokenId = randomUUID();

  const tokenRecord: StoredEnrollmentToken = {
    id: tokenId,
    tokenHash,
    label,
    targetGroupId,
    createdBy,
    expiresAt: expiresAt.toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };

  await storage.saveEnrollmentToken(tokenRecord, expiresInMinutes * 60);

  logger.info({ tokenId, label, expiresInMinutes }, 'Enrollment token created');

  return {
    id: tokenId,
    rawToken,
    label,
    targetGroupId,
    expiresAt,
  };
}

/** List all active enrollment tokens */
export async function listEnrollmentTokens() {
  const storage = getStorage();
  const tokens = await storage.listEnrollmentTokens();
  const groups = await storage.listGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  return tokens.map((t) => ({
    id: t.id,
    label: t.label || null,
    target_group_id: t.targetGroupId || null,
    target_group_name: t.targetGroupId ? groupMap.get(t.targetGroupId) || null : null,
    created_by: t.createdBy || 'admin',
    expires_at: t.expiresAt,
    used_at: t.usedAt || null,
    used_by_machine: t.usedByMachine || null,
    revoked: t.revoked,
    created_at: t.createdAt,
  }));
}

/** Revoke an enrollment token */
export async function revokeEnrollmentToken(tokenId: string): Promise<void> {
  const storage = getStorage();
  const revoked = await storage.revokeEnrollmentToken(tokenId);
  if (!revoked) {
    throw new NotFoundError('Enrollment token');
  }
  logger.info({ tokenId }, 'Enrollment token revoked');
}

/** Enroll a machine using an enrollment token */
export async function enrollMachine(
  rawToken: string,
  machineUid: string,
  systemInfo: {
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
  ipAddress: string,
): Promise<{ machineId: string; machineApiToken: string; config: MachineConfig }> {
  const storage = getStorage();
  const tokenHash = hashToken(rawToken);

  const token = await storage.getEnrollmentTokenByHash(tokenHash);
  if (!token) {
    throw new UnauthorizedError('Invalid enrollment token');
  }

  if (token.revoked) {
    throw new UnauthorizedError('Enrollment token has been revoked');
  }
  if (token.usedAt) {
    throw new UnauthorizedError('Enrollment token has already been used');
  }
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    throw new UnauthorizedError('Enrollment token has expired');
  }

  // Check if machine UID already exists
  const existing = await storage.getMachineByUid(machineUid);
  if (existing) {
    throw new ValidationError('Machine with this UID is already enrolled');
  }

  const machineId = randomUUID();
  const now = new Date().toISOString();

  // Create the machine record
  const machineRecord: StoredMachine = {
    id: machineId,
    machineUid,
    name: systemInfo.hostname || 'PC',
    hostname: systemInfo.hostname || 'localhost',
    os: systemInfo.os || 'unknown',
    osVersion: systemInfo.osVersion,
    cpuModel: systemInfo.cpuModel || 'Unknown CPU',
    cpuCores: systemInfo.cpuCores || 1,
    cpuThreads: systemInfo.cpuThreads || 1,
    ramBytes: systemInfo.ramBytes || 0,
    gpus: systemInfo.gpus || [],
    agentVersion: systemInfo.agentVersion || '0.1.0',
    ipAddress,
    groupId: token.targetGroupId || null,
    status: 'online',
    lastHeartbeat: now,
    registeredAt: now,
    updatedAt: now,
  };

  await storage.saveMachine(machineRecord);

  // Generate machine API token
  const machineApiToken = generateToken('agent');
  const machineTokenHash = hashToken(machineApiToken);

  const credentialRecord: StoredCredential = {
    machineId,
    tokenHash: machineTokenHash,
    issuedAt: now,
    revoked: false,
  };

  await storage.saveMachineCredential(credentialRecord);

  // Create default machine config (Mining = OFF by default)
  const configRecord: MachineConfig = {
    ...DEFAULT_MACHINE_CONFIG,
    id: randomUUID(),
    machineId,
    version: 1,
    miningEnabled: false, // Strictly OFF
    updatedAt: now,
  };

  // If group has default config, apply it (while preserving miningEnabled: false by default)
  if (token.targetGroupId) {
    const group = await storage.getGroup(token.targetGroupId);
    if (group?.defaultConfig) {
      Object.assign(configRecord, group.defaultConfig);
      configRecord.miningEnabled = false; // Always keep OFF on initial enrollment
    }
  }

  await storage.saveMachineConfig(machineId, configRecord);

  // Mark enrollment token as used
  token.usedAt = now;
  token.usedByMachine = machineId;
  await storage.saveEnrollmentToken(token);

  logger.info({ machineId, machineUid, hostname: systemInfo.hostname }, 'Machine enrolled successfully');

  return { machineId, machineApiToken, config: configRecord };
}
