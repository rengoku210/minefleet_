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

export class MemoryStorageAdapter implements StorageAdapter {
  private users = new Map<string, StoredUser>(); // email -> user
  private usersById = new Map<string, string>(); // id -> email
  private machines = new Map<string, StoredMachine>(); // id -> machine
  private machineUidMap = new Map<string, string>(); // uid -> id
  private credentials = new Map<string, StoredCredential>(); // machineId -> cred
  private configs = new Map<string, MachineConfig>(); // machineId -> config
  private states = new Map<string, MachineState>(); // machineId -> state
  private history = new Map<string, CompactTelemetryPoint[]>(); // machineId -> points
  private tokens = new Map<string, StoredEnrollmentToken>(); // id -> token
  private tokenHashMap = new Map<string, string>(); // tokenHash -> id
  private tokenExpiry = new Map<string, number>(); // id -> expiresAt epoch ms
  private commandQueues = new Map<string, QueuedCommand[]>(); // machineId -> commands
  private groups = new Map<string, StoredGroup>(); // id -> group
  private auditLogs: StoredAuditLog[] = [];
  private settings: PlatformSettings = {
    electricityPricePerKwh: 0.12,
    telemetryRetentionDays: 10,
    defaultCurrency: 'USD',
  };

  async init(): Promise<void> {
    // In-memory initialized
  }

  // Users
  async getUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.get(email.toLowerCase()) || null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    const email = this.usersById.get(id);
    if (!email) return null;
    return this.users.get(email) || null;
  }

  async saveUser(user: StoredUser): Promise<void> {
    const email = user.email.toLowerCase();
    this.users.set(email, { ...user, email });
    this.usersById.set(user.id, email);
  }

  async listUsers(): Promise<StoredUser[]> {
    return Array.from(this.users.values());
  }

  async deleteUser(id: string): Promise<boolean> {
    const email = this.usersById.get(id);
    if (!email) return false;
    this.usersById.delete(id);
    return this.users.delete(email);
  }

  // Machines
  async getMachineById(id: string): Promise<StoredMachine | null> {
    return this.machines.get(id) || null;
  }

  async getMachineByUid(uid: string): Promise<StoredMachine | null> {
    const id = this.machineUidMap.get(uid);
    if (!id) return null;
    return this.machines.get(id) || null;
  }

  async saveMachine(machine: StoredMachine): Promise<void> {
    this.machines.set(machine.id, { ...machine });
    this.machineUidMap.set(machine.machineUid, machine.id);
  }

  async listMachines(): Promise<StoredMachine[]> {
    return Array.from(this.machines.values());
  }

  async deleteMachine(id: string): Promise<boolean> {
    const machine = this.machines.get(id);
    if (!machine) return false;
    this.machineUidMap.delete(machine.machineUid);
    this.credentials.delete(id);
    this.configs.delete(id);
    this.states.delete(id);
    this.history.delete(id);
    this.commandQueues.delete(id);
    return this.machines.delete(id);
  }

  private credTokenHashMap = new Map<string, string>(); // tokenHash -> machineId

  // Credentials
  async getMachineCredential(machineId: string): Promise<StoredCredential | null> {
    return this.credentials.get(machineId) || null;
  }

  async saveMachineCredential(cred: StoredCredential): Promise<void> {
    this.credentials.set(cred.machineId, { ...cred });
    this.credTokenHashMap.set(cred.tokenHash, cred.machineId);
  }

  async getMachineIdByTokenHash(tokenHash: string): Promise<string | null> {
    return this.credTokenHashMap.get(tokenHash) || null;
  }

  // Configurations
  async getMachineConfig(machineId: string): Promise<MachineConfig | null> {
    return this.configs.get(machineId) || null;
  }

  async saveMachineConfig(machineId: string, config: MachineConfig): Promise<void> {
    this.configs.set(machineId, { ...config });
  }

  // Live State
  async getMachineState(machineId: string): Promise<MachineState | null> {
    return this.states.get(machineId) || null;
  }

  async saveMachineState(state: MachineState): Promise<void> {
    this.states.set(state.machineId, { ...state });
  }

  // 10-Day Compact History
  async appendTelemetryHistory(machineId: string, point: CompactTelemetryPoint, maxAgeDays = 10): Promise<void> {
    const points = this.history.get(machineId) || [];
    points.push(point);

    // Sliding window cleanup: keep last 10 days
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const trimmed = points.filter((p) => p.t >= cutoff);

    // Cap ring buffer size to max 3,000 points per machine (plenty for 10 days at 5m avg or 30s)
    if (trimmed.length > 3000) {
      trimmed.splice(0, trimmed.length - 3000);
    }

    this.history.set(machineId, trimmed);
  }

  async getTelemetryHistory(machineId: string, durationMinutes = 1440): Promise<CompactTelemetryPoint[]> {
    const points = this.history.get(machineId) || [];
    const cutoff = Date.now() - durationMinutes * 60 * 1000;
    return points.filter((p) => p.t >= cutoff);
  }

  // Enrollment Tokens
  async saveEnrollmentToken(token: StoredEnrollmentToken, ttlSeconds?: number): Promise<void> {
    this.tokens.set(token.id, { ...token });
    this.tokenHashMap.set(token.tokenHash, token.id);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : new Date(token.expiresAt).getTime();
    this.tokenExpiry.set(token.id, expiresAt);
  }

  async getEnrollmentTokenByHash(tokenHash: string): Promise<StoredEnrollmentToken | null> {
    const id = this.tokenHashMap.get(tokenHash);
    if (!id) return null;
    return this.getEnrollmentTokenById(id);
  }

  async getEnrollmentTokenById(id: string): Promise<StoredEnrollmentToken | null> {
    const token = this.tokens.get(id);
    if (!token) return null;

    const expiry = this.tokenExpiry.get(id);
    if (expiry && expiry < Date.now()) {
      // Expired: auto clean
      this.tokens.delete(id);
      this.tokenHashMap.delete(token.tokenHash);
      this.tokenExpiry.delete(id);
      return null;
    }

    return token;
  }

  async listEnrollmentTokens(): Promise<StoredEnrollmentToken[]> {
    const now = Date.now();
    const active: StoredEnrollmentToken[] = [];
    for (const [id, token] of this.tokens.entries()) {
      const expiry = this.tokenExpiry.get(id);
      if (expiry && expiry < now) {
        this.tokens.delete(id);
        this.tokenHashMap.delete(token.tokenHash);
        this.tokenExpiry.delete(id);
      } else {
        active.push(token);
      }
    }
    return active;
  }

  async revokeEnrollmentToken(id: string): Promise<boolean> {
    const token = this.tokens.get(id);
    if (!token) return false;
    token.revoked = true;
    return true;
  }

  // Command Queue
  async pushCommand(machineId: string, command: QueuedCommand): Promise<void> {
    const queue = this.commandQueues.get(machineId) || [];
    queue.push(command);
    this.commandQueues.set(machineId, queue);
  }

  async popCommands(machineId: string): Promise<QueuedCommand[]> {
    const queue = this.commandQueues.get(machineId) || [];
    this.commandQueues.set(machineId, []);
    return queue;
  }

  // Settings
  async getSettings(): Promise<PlatformSettings> {
    return { ...this.settings };
  }

  async saveSettings(settings: Partial<PlatformSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
  }

  // Groups
  async getGroup(id: string): Promise<StoredGroup | null> {
    return this.groups.get(id) || null;
  }

  async saveGroup(group: StoredGroup): Promise<void> {
    this.groups.set(group.id, { ...group });
  }

  async listGroups(): Promise<StoredGroup[]> {
    return Array.from(this.groups.values());
  }

  async deleteGroup(id: string): Promise<boolean> {
    return this.groups.delete(id);
  }

  // Audit Logs
  async logAudit(entry: StoredAuditLog): Promise<void> {
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 500) {
      this.auditLogs.length = 500;
    }
  }

  async listAuditLogs(limit = 100, userId?: string): Promise<StoredAuditLog[]> {
    let logs = this.auditLogs;
    if (userId) {
      logs = logs.filter((l) => l.userId === userId);
    }
    return logs.slice(0, limit);
  }
}
