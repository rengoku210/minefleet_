import { Redis } from '@upstash/redis';
import type {
  StorageAdapter,
  StoredUser,
  StoredMachine,
  StoredCredential,
  StoredEnrollmentToken,
  MachineState,
  CompactTelemetryPoint,
  QueuedCommand,
  StoredGroup,
  PlatformSettings,
  StoredAuditLog,
} from './adapter.js';
import type { MachineConfig } from '@minefleet/shared-types';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('storage-redis');

export class UpstashRedisStorageAdapter implements StorageAdapter {
  private redis: Redis;

  constructor(url?: string, token?: string) {
    if (url && token) {
      this.redis = new Redis({ url, token });
    } else {
      this.redis = Redis.fromEnv();
    }
  }

  async init(): Promise<void> {
    try {
      await this.redis.ping();
      logger.info('Connected to Upstash Redis persistent storage');
    } catch (err) {
      logger.error({ err }, 'Failed to ping Upstash Redis. Check UPSTASH_REDIS_REST_URL and TOKEN.');
      throw err;
    }
  }

  // Users
  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const raw = await this.redis.get<StoredUser>(`mf:user:email:${email.toLowerCase()}`);
    return raw || null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    const email = await this.redis.get<string>(`mf:user:id:${id}`);
    if (!email) return null;
    return this.getUserByEmail(email);
  }

  async saveUser(user: StoredUser): Promise<void> {
    const email = user.email.toLowerCase();
    await this.redis.set(`mf:user:email:${email}`, { ...user, email });
    await this.redis.set(`mf:user:id:${user.id}`, email);
    await this.redis.sadd('mf:users:set', user.id);
  }

  async listUsers(): Promise<StoredUser[]> {
    const userIds = await this.redis.smembers<string[]>('mf:users:set');
    if (!userIds || userIds.length === 0) return [];

    const users: StoredUser[] = [];
    for (const id of userIds) {
      const u = await this.getUserById(id);
      if (u) users.push(u);
    }
    return users;
  }

  async deleteUser(id: string): Promise<boolean> {
    const email = await this.redis.get<string>(`mf:user:id:${id}`);
    if (!email) return false;
    await this.redis.del(`mf:user:email:${email}`);
    await this.redis.del(`mf:user:id:${id}`);
    await this.redis.srem('mf:users:set', id);
    return true;
  }

  // Machines
  async getMachineById(id: string): Promise<StoredMachine | null> {
    const raw = await this.redis.get<StoredMachine>(`mf:machine:${id}`);
    return raw || null;
  }

  async getMachineByUid(uid: string): Promise<StoredMachine | null> {
    const id = await this.redis.get<string>(`mf:uid_map:${uid}`);
    if (!id) return null;
    return this.getMachineById(id);
  }

  async saveMachine(machine: StoredMachine): Promise<void> {
    await this.redis.set(`mf:machine:${machine.id}`, machine);
    await this.redis.set(`mf:uid_map:${machine.machineUid}`, machine.id);
    await this.redis.sadd('mf:machines:set', machine.id);
  }

  async listMachines(): Promise<StoredMachine[]> {
    const ids = await this.redis.smembers<string[]>('mf:machines:set');
    if (!ids || ids.length === 0) return [];

    const machines: StoredMachine[] = [];
    for (const id of ids) {
      const m = await this.getMachineById(id);
      if (m) machines.push(m);
    }
    return machines;
  }

  async deleteMachine(id: string): Promise<boolean> {
    const machine = await this.getMachineById(id);
    if (!machine) return false;

    await this.redis.del(`mf:machine:${id}`);
    await this.redis.del(`mf:uid_map:${machine.machineUid}`);
    await this.redis.del(`mf:cred:${id}`);
    await this.redis.del(`mf:config:${id}`);
    await this.redis.del(`mf:state:${id}`);
    await this.redis.del(`mf:history:${id}`);
    await this.redis.del(`mf:commands:${id}`);
    await this.redis.srem('mf:machines:set', id);
    return true;
  }

  // Credentials
  async getMachineCredential(machineId: string): Promise<StoredCredential | null> {
    const raw = await this.redis.get<StoredCredential>(`mf:cred:${machineId}`);
    return raw || null;
  }

  async saveMachineCredential(cred: StoredCredential): Promise<void> {
    await this.redis.set(`mf:cred:${cred.machineId}`, cred);
  }

  // Configurations
  async getMachineConfig(machineId: string): Promise<MachineConfig | null> {
    const raw = await this.redis.get<MachineConfig>(`mf:config:${machineId}`);
    return raw || null;
  }

  async saveMachineConfig(machineId: string, config: MachineConfig): Promise<void> {
    await this.redis.set(`mf:config:${machineId}`, config);
  }

  // Live State
  async getMachineState(machineId: string): Promise<MachineState | null> {
    const raw = await this.redis.get<MachineState>(`mf:state:${machineId}`);
    return raw || null;
  }

  async saveMachineState(state: MachineState): Promise<void> {
    // Keep live snapshot (expires after 2 days if machine disappears)
    await this.redis.set(`mf:state:${state.machineId}`, state, { ex: 172800 });
  }

  // 10-Day Compact History
  async appendTelemetryHistory(machineId: string, point: CompactTelemetryPoint, maxAgeDays = 10): Promise<void> {
    const key = `mf:history:${machineId}`;
    const raw = JSON.stringify(point);
    await this.redis.rpush(key, raw);

    // Keep max 2,880 points (equivalent to 1 point every 5 min for 10 days)
    await this.redis.ltrim(key, -2880, -1);
    // Set key expiration to 11 days
    await this.redis.expire(key, maxAgeDays * 86400 + 86400);
  }

  async getTelemetryHistory(machineId: string, durationMinutes = 1440): Promise<CompactTelemetryPoint[]> {
    const key = `mf:history:${machineId}`;
    const rawList = await this.redis.lrange<string>(key, 0, -1);
    if (!rawList || rawList.length === 0) return [];

    const cutoff = Date.now() - durationMinutes * 60 * 1000;
    const points: CompactTelemetryPoint[] = [];

    for (const item of rawList) {
      try {
        const p = typeof item === 'string' ? JSON.parse(item) : item;
        if (p && p.t >= cutoff) {
          points.push(p);
        }
      } catch {}
    }

    return points;
  }

  // Enrollment Tokens
  async saveEnrollmentToken(token: StoredEnrollmentToken, ttlSeconds = 3600): Promise<void> {
    await this.redis.set(`mf:token:id:${token.id}`, token, { ex: ttlSeconds });
    await this.redis.set(`mf:token:hash:${token.tokenHash}`, token.id, { ex: ttlSeconds });
    await this.redis.sadd('mf:tokens:set', token.id);
  }

  async getEnrollmentTokenByHash(tokenHash: string): Promise<StoredEnrollmentToken | null> {
    const id = await this.redis.get<string>(`mf:token:hash:${tokenHash}`);
    if (!id) return null;
    return this.getEnrollmentTokenById(id);
  }

  async getEnrollmentTokenById(id: string): Promise<StoredEnrollmentToken | null> {
    const token = await this.redis.get<StoredEnrollmentToken>(`mf:token:id:${id}`);
    if (!token) {
      await this.redis.srem('mf:tokens:set', id);
      return null;
    }
    return token;
  }

  async listEnrollmentTokens(): Promise<StoredEnrollmentToken[]> {
    const ids = await this.redis.smembers<string[]>('mf:tokens:set');
    if (!ids || ids.length === 0) return [];

    const tokens: StoredEnrollmentToken[] = [];
    for (const id of ids) {
      const t = await this.getEnrollmentTokenById(id);
      if (t) tokens.push(t);
    }
    return tokens;
  }

  async revokeEnrollmentToken(id: string): Promise<boolean> {
    const token = await this.getEnrollmentTokenById(id);
    if (!token) return false;
    token.revoked = true;
    await this.redis.set(`mf:token:id:${id}`, token);
    return true;
  }

  // Command Queue
  async pushCommand(machineId: string, command: QueuedCommand): Promise<void> {
    const key = `mf:commands:${machineId}`;
    await this.redis.rpush(key, JSON.stringify(command));
    await this.redis.expire(key, 86400); // Commands expire after 24h
  }

  async popCommands(machineId: string): Promise<QueuedCommand[]> {
    const key = `mf:commands:${machineId}`;
    const items = await this.redis.lrange<string>(key, 0, -1);
    if (!items || items.length === 0) return [];

    await this.redis.del(key);
    const commands: QueuedCommand[] = [];
    for (const item of items) {
      try {
        const cmd = typeof item === 'string' ? JSON.parse(item) : item;
        if (cmd) commands.push(cmd);
      } catch {}
    }
    return commands;
  }

  // Settings
  async getSettings(): Promise<PlatformSettings> {
    const raw = await this.redis.get<PlatformSettings>('mf:settings');
    return raw || {
      electricityPricePerKwh: 0.12,
      telemetryRetentionDays: 10,
      defaultCurrency: 'USD',
    };
  }

  async saveSettings(settings: Partial<PlatformSettings>): Promise<void> {
    const current = await this.getSettings();
    await this.redis.set('mf:settings', { ...current, ...settings });
  }

  // Groups
  async getGroup(id: string): Promise<StoredGroup | null> {
    const raw = await this.redis.get<StoredGroup>(`mf:group:${id}`);
    return raw || null;
  }

  async saveGroup(group: StoredGroup): Promise<void> {
    await this.redis.set(`mf:group:${group.id}`, group);
    await this.redis.sadd('mf:groups:set', group.id);
  }

  async listGroups(): Promise<StoredGroup[]> {
    const ids = await this.redis.smembers<string[]>('mf:groups:set');
    if (!ids || ids.length === 0) return [];

    const groups: StoredGroup[] = [];
    for (const id of ids) {
      const g = await this.getGroup(id);
      if (g) groups.push(g);
    }
    return groups;
  }

  async deleteGroup(id: string): Promise<boolean> {
    await this.redis.del(`mf:group:${id}`);
    await this.redis.srem('mf:groups:set', id);
    return true;
  }

  // Audit Logs
  async logAudit(entry: StoredAuditLog): Promise<void> {
    await this.redis.lpush('mf:audit_logs', JSON.stringify(entry));
    await this.redis.ltrim('mf:audit_logs', 0, 499); // Keep latest 500 audit logs
  }

  async listAuditLogs(limit = 100, userId?: string): Promise<StoredAuditLog[]> {
    const raw = await this.redis.lrange<string>('mf:audit_logs', 0, limit - 1);
    if (!raw || raw.length === 0) return [];

    const logs: StoredAuditLog[] = [];
    for (const item of raw) {
      try {
        const l = typeof item === 'string' ? JSON.parse(item) : item;
        if (l && (!userId || l.userId === userId)) {
          logs.push(l);
        }
      } catch {}
    }
    return logs;
  }
}
