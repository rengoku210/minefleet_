import type { MachineConfig } from '@minefleet/shared-types';
import { collectTelemetry } from '../system/monitor.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('workload');

export type WorkloadAction = 'none' | 'reduce' | 'pause';

export class WorkloadProtection {
  private config: MachineConfig | null = null;
  private lastAction: WorkloadAction = 'none';
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private onAction: ((action: WorkloadAction, cpuPercent: number) => void) | null = null;
  // Use a rolling average to prevent oscillation
  private cpuHistory: number[] = [];
  private readonly historySize = 6; // 30 seconds at 5s intervals

  setConfig(config: MachineConfig): void {
    this.config = config;
  }

  setOnAction(handler: (action: WorkloadAction, cpuPercent: number) => void): void {
    this.onAction = handler;
  }

  start(): void {
    this.stop();
    this.cpuHistory = [];
    this.checkInterval = setInterval(() => this.check(), 5000);
    logger.info('Workload protection started');
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async check(): Promise<void> {
    if (!this.config) return;

    const telemetry = await collectTelemetry();
    this.cpuHistory.push(telemetry.cpuPercent);
    if (this.cpuHistory.length > this.historySize) {
      this.cpuHistory.shift();
    }

    // Use average CPU to prevent oscillation
    const avgCpu = this.cpuHistory.reduce((a, b) => a + b, 0) / this.cpuHistory.length;

    let newAction: WorkloadAction = 'none';

    if (avgCpu >= this.config.pauseCpuAbove) {
      newAction = 'pause';
    } else if (avgCpu >= this.config.reduceCpuAbove) {
      newAction = 'reduce';
    } else if (this.lastAction !== 'none' && avgCpu <= this.config.resumeCpuBelow) {
      newAction = 'none';
    } else {
      newAction = this.lastAction;
    }

    if (newAction !== this.lastAction) {
      logger.info({ avgCpu, action: newAction, previous: this.lastAction }, 'Workload action changed');
      this.lastAction = newAction;
      this.onAction?.(newAction, avgCpu);
    }
  }
}
