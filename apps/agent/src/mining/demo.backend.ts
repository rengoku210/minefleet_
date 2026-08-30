import type { MiningBackend, MiningLimits } from './backend.js';
import type { MiningStatus } from '@minefleet/shared-types';
import { createChildLogger } from '../utils/logger.js';
import { cpus } from 'node:os';

const logger = createChildLogger('demo-backend');

/** Demo mining backend that simulates mining activity for testing */
export class DemoBackend implements MiningBackend {
  readonly name = 'demo';
  private status: MiningStatus = 'idle';
  private hashrate: number | null = null;
  private threads = 1;
  private cpuLimit = 20;
  private interval: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.status === 'mining') return;
    this.status = 'mining';
    this.simulateHashrate();
    logger.info({ threads: this.threads }, 'Demo mining started');
  }

  async stop(): Promise<void> {
    this.status = 'stopped';
    this.hashrate = null;
    this.stopSimulation();
    logger.info('Demo mining stopped');
  }

  async pause(): Promise<void> {
    if (this.status !== 'mining') return;
    this.status = 'paused';
    this.hashrate = null;
    this.stopSimulation();
    logger.info('Demo mining paused');
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    this.status = 'mining';
    this.simulateHashrate();
    logger.info('Demo mining resumed');
  }

  getStatus(): MiningStatus {
    return this.status;
  }

  getHashrate(): number | null {
    return this.hashrate;
  }

  async applyLimits(limits: MiningLimits): Promise<void> {
    this.cpuLimit = limits.cpuLimitPercent;
    this.threads = limits.maxThreads || Math.max(1, Math.floor(cpus().length * (limits.cpuLimitPercent / 100)));
    logger.info({ cpuLimit: this.cpuLimit, threads: this.threads }, 'Limits applied');

    // Recalculate hashrate if mining
    if (this.status === 'mining') {
      this.stopSimulation();
      this.simulateHashrate();
    }
  }

  async isSupported(): Promise<boolean> {
    return true; // Demo always works
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private simulateHashrate(): void {
    this.stopSimulation();
    this.interval = setInterval(() => {
      if (this.status === 'mining') {
        // Simulate ~100-500 H/s per thread with some variance
        const baseRate = 250 * this.threads;
        const variance = (Math.random() - 0.5) * 100 * this.threads;
        const limitFactor = this.cpuLimit / 100;
        this.hashrate = Math.max(0, Math.round((baseRate + variance) * limitFactor));
      }
    }, 2000);
  }

  private stopSimulation(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
