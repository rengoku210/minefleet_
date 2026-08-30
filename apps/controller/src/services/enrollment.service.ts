import { getStorage } from '../storage/index.js';
import { generateToken, hashToken } from '../utils/crypto.js';
import { NotFoundError, ValidationError, UnauthorizedError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import type { MachineConfig } from '@minefleet/shared-types';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';
import type { StoredEnrollmentToken, StoredMachine, StoredCredential } from '../storage/adapter.js';
import { loadConfig } from '../config.js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

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

/** Create a new enrollment token with HMAC signature for stateless serverless verification */
export async function createEnrollmentToken(options: CreateTokenOptions): Promise<TokenInfo> {
  const storage = getStorage();
  const config = loadConfig();
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

  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  // Payload for signed token
  const payload = {
    id: tokenId,
    sub: createdBy,
    targetGroupId: targetGroupId || undefined,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: generateToken('n'),
  };

  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.jwt.secret)
    .update(payloadEncoded)
    .digest('hex');

  // Cryptographically signed token: enroll_<base64url-payload>.<hmac-sha256-signature>
  const rawToken = `enroll_${payloadEncoded}.${signature}`;
  const tokenHash = hashToken(rawToken);

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

  try {
    await storage.saveEnrollmentToken(tokenRecord, expiresInMinutes * 60);
  } catch (err) {
    logger.warn({ err }, 'Failed saving token to storage (stateless HMAC will still verify)');
  }

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

/** Enroll a machine using an enrollment token (idempotent & serverless-resilient) */
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
  const config = loadConfig();

  let targetGroupId: string | null = null;
  let validSignature = false;

  // 1. Verify HMAC-signed enrollment token
  if (rawToken && rawToken.startsWith('enroll_') && rawToken.includes('.')) {
    const parts = rawToken.substring(7).split('.');
    if (parts.length === 2) {
      const [payloadEncoded, signature] = parts;
      try {
        const expectedSig = createHmac('sha256', config.jwt.secret)
          .update(payloadEncoded)
          .digest('hex');

        if (
          signature.length === expectedSig.length &&
          timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
        ) {
          const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf-8'));
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            throw new UnauthorizedError('Enrollment token has expired');
          }
          targetGroupId = payload.targetGroupId || null;
          validSignature = true;
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedError) throw err;
        logger.warn({ err: err?.message }, 'Failed parsing signed token payload');
      }
    }
  }

  // 2. Also check persistent storage if available
  const tokenHash = hashToken(rawToken);
  const tokenFromStorage = await storage.getEnrollmentTokenByHash(tokenHash);

  if (tokenFromStorage) {
    if (tokenFromStorage.revoked) {
      throw new UnauthorizedError('Enrollment token has been revoked');
    }
    if (tokenFromStorage.usedAt) {
      throw new UnauthorizedError('Enrollment token has already been used');
    }
    if (new Date(tokenFromStorage.expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedError('Enrollment token has expired');
    }
    targetGroupId = tokenFromStorage.targetGroupId || targetGroupId;
  } else if (!validSignature) {
    throw new UnauthorizedError('Invalid enrollment token');
  }

  const now = new Date().toISOString();

  // 3. Idempotent machine creation/update (handles re-enrollment safely)
  let machineId: string;
  const existing = await storage.getMachineByUid(machineUid);

  if (existing) {
    machineId = existing.id;
    existing.name = systemInfo.hostname || existing.name;
    existing.hostname = systemInfo.hostname || existing.hostname;
    existing.os = systemInfo.os || existing.os;
    existing.osVersion = systemInfo.osVersion || existing.osVersion;
    existing.cpuModel = systemInfo.cpuModel || existing.cpuModel;
    existing.cpuCores = systemInfo.cpuCores || existing.cpuCores;
    existing.cpuThreads = systemInfo.cpuThreads || existing.cpuThreads;
    existing.ramBytes = systemInfo.ramBytes || existing.ramBytes;
    existing.gpus = systemInfo.gpus || existing.gpus;
    existing.agentVersion = systemInfo.agentVersion || existing.agentVersion;
    existing.ipAddress = ipAddress;
    existing.status = 'online';
    existing.lastHeartbeat = now;
    existing.updatedAt = now;
    await storage.saveMachine(existing);
    logger.info({ machineId, machineUid }, 'Existing machine record refreshed upon re-enrollment');
  } else {
    machineId = randomUUID();
    const machineRecord: StoredMachine = {
      id: machineId,
      machineUid,
      name: systemInfo.hostname || 'PC',
      hostname: systemInfo.hostname || 'localhost',
      os: systemInfo.os || 'unknown',
      osVersion: systemInfo.osVersion || '',
      cpuModel: systemInfo.cpuModel || 'Unknown CPU',
      cpuCores: systemInfo.cpuCores || 1,
      cpuThreads: systemInfo.cpuThreads || 1,
      ramBytes: systemInfo.ramBytes || 0,
      gpus: systemInfo.gpus || [],
      agentVersion: systemInfo.agentVersion || '0.2.0',
      ipAddress,
      groupId: targetGroupId,
      status: 'online',
      lastHeartbeat: now,
      registeredAt: now,
      updatedAt: now,
    };
    await storage.saveMachine(machineRecord);
  }

  // 4. Generate fresh machine API token
  const machineApiToken = generateToken('agent');
  const machineTokenHash = hashToken(machineApiToken);

  const credentialRecord: StoredCredential = {
    machineId,
    tokenHash: machineTokenHash,
    issuedAt: now,
    revoked: false,
  };
  await storage.saveMachineCredential(credentialRecord);

  // 5. Create/ensure machine config (Mining = OFF by default)
  let configRecord = await storage.getMachineConfig(machineId);
  if (!configRecord) {
    configRecord = {
      ...DEFAULT_MACHINE_CONFIG,
      id: randomUUID(),
      machineId,
      version: 1,
      miningEnabled: false, // Strictly OFF
      updatedAt: now,
    };

    if (targetGroupId) {
      const group = await storage.getGroup(targetGroupId);
      if (group?.defaultConfig) {
        Object.assign(configRecord, group.defaultConfig);
        configRecord.miningEnabled = false; // Always keep OFF on initial enrollment
      }
    }

    await storage.saveMachineConfig(machineId, configRecord);
  }

  // 6. Mark token as used if stored in persistent storage
  if (tokenFromStorage) {
    tokenFromStorage.usedAt = now;
    tokenFromStorage.usedByMachine = machineId;
    await storage.saveEnrollmentToken(tokenFromStorage);
  }

  logger.info({ machineId, machineUid, hostname: systemInfo.hostname }, 'Machine enrolled successfully');

  return { machineId, machineApiToken, config: configRecord };
}
