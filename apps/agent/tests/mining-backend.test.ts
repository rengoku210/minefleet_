import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DemoBackend } from '../src/mining/demo.backend.js';

describe('DemoBackend', () => {
  let backend: DemoBackend;

  beforeEach(() => {
    backend = new DemoBackend();
  });

  afterEach(async () => {
    await backend.destroy();
  });

  it('should start in idle state', () => {
    expect(backend.getStatus()).toBe('idle');
    expect(backend.getHashrate()).toBeNull();
  });

  it('should transition to mining on start', async () => {
    await backend.start();
    expect(backend.getStatus()).toBe('mining');
  });

  it('should stop mining', async () => {
    await backend.start();
    await backend.stop();
    expect(backend.getStatus()).toBe('stopped');
    expect(backend.getHashrate()).toBeNull();
  });

  it('should pause and resume', async () => {
    await backend.start();
    await backend.pause();
    expect(backend.getStatus()).toBe('paused');

    await backend.resume();
    expect(backend.getStatus()).toBe('mining');
  });

  it('should not resume from non-paused state', async () => {
    await backend.resume(); // should be no-op
    expect(backend.getStatus()).toBe('idle');
  });

  it('should apply limits', async () => {
    await backend.applyLimits({
      cpuLimitPercent: 50,
      maxThreads: 4,
      gpuEnabled: false,
    });
    // Should not throw
  });

  it('should always be supported', async () => {
    expect(await backend.isSupported()).toBe(true);
  });

  it('should generate hashrate when mining', async () => {
    await backend.start();
    // Wait for simulation tick
    await new Promise(resolve => setTimeout(resolve, 2500));
    const hashrate = backend.getHashrate();
    expect(hashrate).not.toBeNull();
    expect(hashrate!).toBeGreaterThan(0);
  });
});
