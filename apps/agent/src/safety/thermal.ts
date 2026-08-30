import type { MachineConfig } from '@minefleet/shared-types';
import { collectTelemetry } from '../system/monitor.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('thermal');

export type ThermalAction = 'none' | 'reduce' | 'pause';

export class ThermalProtection {
  private config: MachineConfig | null = null;
  private lastAction: ThermalAction = 'none';
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private onAction: ((action: ThermalAction, temp: number) => void) | null = null;

  setConfig(config: MachineConfig): void {
    this.config = config;
  }

  setOnAction(handler: (action: ThermalAction, temp: number) => void): void {
    this.onAction = handler;
  }

  start(): void {
    this.stop();
    this.checkInterval = setInterval(() => this.check(), 5000);
    logger.info('Thermal protection started');
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
    const temp = telemetry.cpuTempC ?? telemetry.gpuTempC;
    if (temp === null) return;

    let newAction: ThermalAction = 'none';

    if (temp >= this.config.tempPauseC) {
      newAction = 'pause';
    } else if (temp >= this.config.tempReduceC) {
      newAction = 'reduce';
    } else if (this.lastAction !== 'none' && temp <= this.config.tempResumeC) {
      newAction = 'none';
    } else {
      // Hysteresis: maintain current state if between thresholds
      newAction = this.lastAction;
    }

    if (newAction !== this.lastAction) {
      logger.info({ temp, action: newAction, previous: this.lastAction }, 'Thermal action changed');
      this.lastAction = newAction;
      this.onAction?.(newAction, temp);
    }
  }
}
