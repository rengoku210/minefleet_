import type { MiningBackend, MiningLimits } from './backend.js';
import type { MachineConfig, MiningStatus } from '@minefleet/shared-types';
import { DemoBackend } from './demo.backend.js';
import { setMiningState } from '../system/monitor.js';
import { createChildLogger } from '../utils/logger.js';
import { cpus } from 'node:os';

const logger = createChildLogger('mining-manager');

export class MiningManager {
  private backend: MiningBackend;
  private currentConfig: MachineConfig | null = null;
  private statusUpdateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Default to demo backend
    this.backend = new DemoBackend();
    this.startStatusUpdates();
  }

  async start(): Promise<void> {
    if (!this.currentConfig?.miningEnabled) {
      logger.warn('Mining is not enabled in config, ignoring start command');
      return;
    }
    await this.backend.start();
    logger.info('Mining started');
  }

  async stop(reason: string = 'user'): Promise<void> {
    await this.backend.stop();
    logger.info({ reason }, 'Mining stopped');
  }

  async pause(): Promise<void> {
    await this.backend.pause();
    logger.info('Mining paused');
  }

  async resume(): Promise<void> {
    if (!this.currentConfig?.miningEnabled) {
      logger.warn('Mining is not enabled in config, ignoring resume command');
      return;
    }
    await this.backend.resume();
    logger.info('Mining resumed');
  }

  async applyConfig(config: MachineConfig): Promise<void> {
    this.currentConfig = config;

    const limits: MiningLimits = {
      cpuLimitPercent: config.cpuLimitPercent,
      maxThreads: config.maxMiningThreads || Math.max(1, Math.floor(cpus().length * (config.cpuLimitPercent / 100))),
      gpuEnabled: config.gpuEnabled,
    };

    await this.backend.applyLimits(limits);

    // If mining was enabled and is now disabled, stop
    if (!config.miningEnabled && this.backend.getStatus() === 'mining') {
      await this.stop('config_change');
    }

    logger.info({ cpuLimit: config.cpuLimitPercent, miningEnabled: config.miningEnabled }, 'Config applied to mining manager');
  }

  getStatus(): MiningStatus {
    return this.backend.getStatus();
  }

  getHashrate(): number | null {
    return this.backend.getHashrate();
  }

  getBackendName(): string {
    return this.backend.name;
  }

  async destroy(): Promise<void> {
    this.stopStatusUpdates();
    await this.backend.destroy();
  }

  private startStatusUpdates(): void {
    this.statusUpdateInterval = setInterval(() => {
      setMiningState(
        this.backend.getStatus(),
        this.currentConfig?.maxMiningThreads || 0,
        this.backend.getHashrate(),
      );
    }, 2000);
  }

  private stopStatusUpdates(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
  }
}
