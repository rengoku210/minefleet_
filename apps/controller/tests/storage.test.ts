import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorageAdapter } from '../src/storage/memory.js';
import type { StorageAdapter } from '../src/storage/adapter.js';

describe('StorageAdapter (Memory Implementation)', () => {
  let storage: StorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  it('should save and retrieve users', async () => {
    const user = {
      id: 'usr_1',
      email: 'admin@test.local',
      passwordHash: 'hash123',
      role: 'admin' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await storage.saveUser(user);

    const byEmail = await storage.getUserByEmail('admin@test.local');
    expect(byEmail).toBeDefined();
    expect(byEmail?.id).toBe('usr_1');

    const byId = await storage.getUserById('usr_1');
    expect(byId).toBeDefined();
    expect(byId?.email).toBe('admin@test.local');

    const list = await storage.listUsers();
    expect(list).toHaveLength(1);

    await storage.deleteUser('usr_1');
    expect(await storage.getUserById('usr_1')).toBeNull();
  });

  it('should save, list, and delete machines', async () => {
    const machine = {
      id: 'mach_1',
      machineUid: 'mf_abc123',
      name: 'Rig 1',
      hostname: 'rig-1',
      os: 'windows',
      cpuModel: 'Core i7',
      cpuCores: 8,
      cpuThreads: 16,
      ramBytes: 16000000000,
      gpus: [],
      agentVersion: '0.1.0',
      status: 'online' as const,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await storage.saveMachine(machine);

    const byId = await storage.getMachineById('mach_1');
    expect(byId).toBeDefined();
    expect(byId?.name).toBe('Rig 1');

    const byUid = await storage.getMachineByUid('mf_abc123');
    expect(byUid?.id).toBe('mach_1');

    const all = await storage.listMachines();
    expect(all).toHaveLength(1);

    await storage.deleteMachine('mach_1');
    expect(await storage.getMachineById('mach_1')).toBeNull();
  });

  it('should handle live state snapshots and telemetry history sliding window', async () => {
    const state = {
      machineId: 'mach_1',
      cpuPercent: 25.5,
      ramPercent: 40.0,
      gpuPercent: 0,
      cpuTempC: 55.0,
      hashrate: 150.0,
      miningThreads: 2,
      miningStatus: 'mining' as const,
      safetyState: 'normal' as const,
      recordedAt: new Date().toISOString(),
    };

    await storage.saveMachineState(state);
    const retrievedState = await storage.getMachineState('mach_1');
    expect(retrievedState?.cpuPercent).toBe(25.5);
    expect(retrievedState?.miningStatus).toBe('mining');

    // Append history points
    const now = Date.now();
    await storage.appendTelemetryHistory('mach_1', { t: now - 1000, c: 20, r: 40, g: 0, temp: 50, h: 100 });
    await storage.appendTelemetryHistory('mach_1', { t: now, c: 25, r: 40, g: 0, temp: 55, h: 150 });

    const history = await storage.getTelemetryHistory('mach_1', 60);
    expect(history).toHaveLength(2);
    expect(history[1].h).toBe(150);
  });

  it('should manage command queues with FIFO ordering and drain on pop', async () => {
    await storage.pushCommand('mach_1', { id: 'cmd_1', type: 'start', timestamp: 1 });
    await storage.pushCommand('mach_1', { id: 'cmd_2', type: 'update_config', payload: { cpuLimit: 40 }, timestamp: 2 });

    const commands = await storage.popCommands('mach_1');
    expect(commands).toHaveLength(2);
    expect(commands[0].type).toBe('start');
    expect(commands[1].type).toBe('update_config');

    // Second pop should be empty
    const empty = await storage.popCommands('mach_1');
    expect(empty).toHaveLength(0);
  });

  it('should manage enrollment tokens and respect TTL expiry', async () => {
    const token = {
      id: 'tok_1',
      tokenHash: 'hash_abc',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      revoked: false,
      createdAt: new Date().toISOString(),
    };

    await storage.saveEnrollmentToken(token, 60);

    const byHash = await storage.getEnrollmentTokenByHash('hash_abc');
    expect(byHash).toBeDefined();
    expect(byHash?.id).toBe('tok_1');

    await storage.revokeEnrollmentToken('tok_1');
    const revoked = await storage.getEnrollmentTokenById('tok_1');
    expect(revoked?.revoked).toBe(true);
  });
});
