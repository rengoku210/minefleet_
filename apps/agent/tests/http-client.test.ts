import { describe, it, expect, beforeEach } from 'vitest';
import { AgentHttpClient } from '../src/connection/http-client.js';
import { MiningManager } from '../src/mining/manager.js';

describe('AgentHttpClient (Stateless HTTP protocol)', () => {
  let miningManager: MiningManager;
  let client: AgentHttpClient;

  beforeEach(() => {
    miningManager = new MiningManager();
    client = new AgentHttpClient('http://localhost:3001', miningManager);
  });

  it('should initialize with mining strictly OFF by default', () => {
    const status = miningManager.getStatus();
    expect(status).toBe('idle');
  });

  it('should execute start command when received from controller', async () => {
    await (client as any).handleCommand({ id: 'cmd_1', type: 'start' });
    const status = miningManager.getStatus();
    expect(status).toBe('mining');
  });

  it('should execute stop command when received from controller', async () => {
    await (client as any).handleCommand({ id: 'cmd_1', type: 'start' });
    expect(miningManager.getStatus()).toBe('mining');

    await (client as any).handleCommand({ id: 'cmd_2', type: 'stop' });
    expect(miningManager.getStatus()).toBe('stopped');
  });

  it('should execute pause and resume commands', async () => {
    await (client as any).handleCommand({ id: 'cmd_1', type: 'start' });
    await (client as any).handleCommand({ id: 'cmd_2', type: 'pause' });
    expect(miningManager.getStatus()).toBe('paused');

    await (client as any).handleCommand({ id: 'cmd_3', type: 'resume' });
    expect(miningManager.getStatus()).toBe('mining');
  });
});
