import { describe, it, expect } from 'vitest';
import { DEFAULT_MACHINE_CONFIG } from '@minefleet/shared-types';

describe('Default Machine Config', () => {
  it('should have mining disabled by default', () => {
    expect(DEFAULT_MACHINE_CONFIG.miningEnabled).toBe(false);
  });

  it('should have conservative workload policy by default', () => {
    expect(DEFAULT_MACHINE_CONFIG.workloadPolicy).toBe('conservative');
  });

  it('should have reasonable CPU limits', () => {
    expect(DEFAULT_MACHINE_CONFIG.cpuLimitPercent).toBe(20);
    expect(DEFAULT_MACHINE_CONFIG.cpuLimitPercent).toBeGreaterThan(0);
    expect(DEFAULT_MACHINE_CONFIG.cpuLimitPercent).toBeLessThanOrEqual(100);
  });

  it('should have GPU disabled by default', () => {
    expect(DEFAULT_MACHINE_CONFIG.gpuEnabled).toBe(false);
  });

  it('should have safe temperature thresholds', () => {
    expect(DEFAULT_MACHINE_CONFIG.tempWarningC).toBeLessThan(DEFAULT_MACHINE_CONFIG.tempReduceC);
    expect(DEFAULT_MACHINE_CONFIG.tempReduceC).toBeLessThan(DEFAULT_MACHINE_CONFIG.tempPauseC);
    expect(DEFAULT_MACHINE_CONFIG.tempResumeC).toBeLessThan(DEFAULT_MACHINE_CONFIG.tempWarningC);
  });

  it('should have safe CPU thresholds', () => {
    expect(DEFAULT_MACHINE_CONFIG.resumeCpuBelow).toBeLessThan(DEFAULT_MACHINE_CONFIG.reduceCpuAbove);
    expect(DEFAULT_MACHINE_CONFIG.reduceCpuAbove).toBeLessThan(DEFAULT_MACHINE_CONFIG.pauseCpuAbove);
  });

  it('should not have pool config by default', () => {
    expect(DEFAULT_MACHINE_CONFIG.poolConfig).toBeNull();
  });
});
