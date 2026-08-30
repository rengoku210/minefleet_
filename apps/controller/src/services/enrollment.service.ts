import { queryOne, queryAll, query, withTransaction } from '../db/pool.js';
import { generateToken, hashToken, hashPassword } from '../utils/crypto.js';
import { NotFoundError, ValidationError, UnauthorizedError } from '../utils/errors.js';
import { createChildLogger } from '../utils/logger.js';
import { loadConfig } from '../config.js';
import type { MachineConfig } from '@minefleet/shared-types';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';

const logger = createChildLogger('enrollment');

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
  const {
    createdBy,
    label = null,
    targetGroupId = null,
    expiresInMinutes = 60,
  } = options;

  // Validate group exists if specified
  if (targetGroupId) {
    const group = await queryOne('SELECT id FROM machine_groups WHERE id = $1', [targetGroupId]);
    if (!group) {
      throw new NotFoundError('Machine group');
    }
  }

  const rawToken = generateToken('enroll');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const result = await queryOne<{ id: string }>(
    `INSERT INTO enrollment_tokens (id, created_by, token_hash, label, target_group_id, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [createdBy, tokenHash, label, targetGroupId, expiresAt.toISOString()],
  );

  logger.info({ tokenId: result!.id, label, expiresInMinutes }, 'Enrollment token created');

  return {
    id: result!.id,
    rawToken,
    label,
    targetGroupId,
    expiresAt,
  };
}

/** List all enrollment tokens */
export async function listEnrollmentTokens() {
  return queryAll(
    `SELECT et.id, et.label, et.target_group_id, mg.name as target_group_name,
            u.email as created_by, et.expires_at, et.used_at, et.used_by_machine,
            et.revoked, et.created_at
     FROM enrollment_tokens et
     LEFT JOIN machine_groups mg ON mg.id = et.target_group_id
     LEFT JOIN users u ON u.id = et.created_by
     ORDER BY et.created_at DESC
     LIMIT 100`,
  );
}

/** Revoke an enrollment token */
export async function revokeEnrollmentToken(tokenId: string): Promise<void> {
  const result = await query(
    'UPDATE enrollment_tokens SET revoked = true WHERE id = $1 AND used_at IS NULL',
    [tokenId],
  );
  if (result.rowCount === 0) {
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
): Promise<{ machineId: string; machineApiToken: string; config: any }> {
  const tokenHash = hashToken(rawToken);

  return withTransaction(async (client) => {
    // Find and validate the token
    const token = await client.query(
      `SELECT id, target_group_id, expires_at, used_at, revoked
       FROM enrollment_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (token.rows.length === 0) {
      throw new UnauthorizedError('Invalid enrollment token');
    }

    const tokenRow = token.rows[0];

    if (tokenRow.revoked) {
      throw new UnauthorizedError('Enrollment token has been revoked');
    }
    if (tokenRow.used_at) {
      throw new UnauthorizedError('Enrollment token has already been used');
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      throw new UnauthorizedError('Enrollment token has expired');
    }

    // Check if machine UID already exists
    const existing = await client.query(
      'SELECT id FROM machines WHERE machine_uid = $1',
      [machineUid],
    );
    if (existing.rows.length > 0) {
      throw new ValidationError('Machine with this UID is already enrolled');
    }

    // Create the machine record
    const machineResult = await client.query(
      `INSERT INTO machines (
        id, machine_uid, name, hostname, os, os_version,
        cpu_model, cpu_cores, cpu_threads, ram_bytes, gpus,
        agent_version, ip_address, group_id, status
      ) VALUES (
        gen_random_uuid(), $1, $2, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, 'online'
      ) RETURNING id`,
      [
        machineUid,
        systemInfo.hostname,
        systemInfo.os,
        systemInfo.osVersion,
        systemInfo.cpuModel,
        systemInfo.cpuCores,
        systemInfo.cpuThreads,
        systemInfo.ramBytes,
        JSON.stringify(systemInfo.gpus),
        systemInfo.agentVersion,
        ipAddress,
        tokenRow.target_group_id,
      ],
    );

    const machineId = machineResult.rows[0].id;

    // Generate machine API token
    const machineApiToken = generateToken('agent');
    const machineTokenHash = hashToken(machineApiToken);

    await client.query(
      `INSERT INTO machine_credentials (id, machine_id, token_hash)
       VALUES (gen_random_uuid(), $1, $2)`,
      [machineId, machineTokenHash],
    );

    // Create default machine config
    const configDefaults = DEFAULT_MACHINE_CONFIG;
    
    // Check if group has default config
    if (tokenRow.target_group_id) {
      const groupConfig = await client.query(
        'SELECT config FROM group_configs WHERE group_id = $1',
        [tokenRow.target_group_id],
      );
      if (groupConfig.rows.length > 0 && groupConfig.rows[0].config) {
        Object.assign(configDefaults, groupConfig.rows[0].config);
      }
    }

    const configResult = await client.query(
      `INSERT INTO machine_configs (
        id, machine_id, version, mining_enabled, cpu_limit_percent,
        max_mining_threads, gpu_enabled, gpu_settings, workload_policy,
        pause_cpu_above, reduce_cpu_above, resume_cpu_below,
        temp_warning_c, temp_reduce_c, temp_pause_c, temp_resume_c,
        pool_config, custom
      ) VALUES (
        gen_random_uuid(), $1, 1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16
      ) RETURNING *`,
      [
        machineId,
        configDefaults.miningEnabled,
        configDefaults.cpuLimitPercent,
        configDefaults.maxMiningThreads,
        configDefaults.gpuEnabled,
        JSON.stringify(configDefaults.gpuSettings),
        configDefaults.workloadPolicy,
        configDefaults.pauseCpuAbove,
        configDefaults.reduceCpuAbove,
        configDefaults.resumeCpuBelow,
        configDefaults.tempWarningC,
        configDefaults.tempReduceC,
        configDefaults.tempPauseC,
        configDefaults.tempResumeC,
        configDefaults.poolConfig ? JSON.stringify(configDefaults.poolConfig) : null,
        JSON.stringify(configDefaults.custom),
      ],
    );

    // Mark the enrollment token as used
    await client.query(
      'UPDATE enrollment_tokens SET used_at = NOW(), used_by_machine = $1 WHERE id = $2',
      [machineId, tokenRow.id],
    );

    logger.info({ machineId, machineUid, hostname: systemInfo.hostname }, 'Machine enrolled successfully');

    // Build config response
    const configRow = configResult.rows[0];
    const config = {
      id: configRow.id,
      machineId: configRow.machine_id,
      version: configRow.version,
      miningEnabled: configRow.mining_enabled,
      cpuLimitPercent: configRow.cpu_limit_percent,
      maxMiningThreads: configRow.max_mining_threads,
      gpuEnabled: configRow.gpu_enabled,
      gpuSettings: configRow.gpu_settings,
      workloadPolicy: configRow.workload_policy,
      pauseCpuAbove: configRow.pause_cpu_above,
      reduceCpuAbove: configRow.reduce_cpu_above,
      resumeCpuBelow: configRow.resume_cpu_below,
      tempWarningC: configRow.temp_warning_c,
      tempReduceC: configRow.temp_reduce_c,
      tempPauseC: configRow.temp_pause_c,
      tempResumeC: configRow.temp_resume_c,
      poolConfig: configRow.pool_config,
      custom: configRow.custom,
      updatedAt: configRow.updated_at,
    };

    return { machineId, machineApiToken, config };
  });
}
