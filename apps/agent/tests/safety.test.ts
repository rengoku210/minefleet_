import { describe, it, expect } from 'vitest';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';
import { MiningManager } from '../src/mining/manager.js';

describe('Safety Invariants', () => {
  it('mining should be disabled by default', () => {
    expect(DEFAULT_MACHINE_CONFIG.miningEnabled).toBe(false);
  });

  it('mining manager should not start if config says disabled', async () => {
    const manager = new MiningManager();
    
    // Apply a config with mining disabled
    await manager.applyConfig({
      ...DEFAULT_MACHINE_CONFIG,
      id: 'test',
      machineId: 'test',
      version: 1,
      updatedAt: new Date().toISOString(),
      miningEnabled: false,
    } as any);

    // Try to start - should be ignored because config disables it
    await manager.start();
    expect(manager.getStatus()).not.toBe('mining');

    await manager.destroy();
  });

  it('default config should not use maximum resources', () => {
    expect(DEFAULT_MACHINE_CONFIG.cpuLimitPercent).toBeLessThanOrEqual(50);
    expect(DEFAULT_MACHINE_CONFIG.gpuEnabled).toBe(false);
  });

  it('temperature thresholds should be in safe order', () => {
    // Resume < Warning < Reduce < Pause
    const c = DEFAULT_MACHINE_CONFIG;
    expect(c.tempResumeC).toBeLessThan(c.tempWarningC);
    expect(c.tempWarningC).toBeLessThan(c.tempReduceC);
    expect(c.tempReduceC).toBeLessThan(c.tempPauseC);
  });

  it('workload thresholds should prevent oscillation', () => {
    const c = DEFAULT_MACHINE_CONFIG;
    // Resume threshold should be well below reduce threshold (hysteresis)
    expect(c.resumeCpuBelow).toBeLessThan(c.reduceCpuAbove - 10);
  });
});
