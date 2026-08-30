import { createChildLogger } from '../utils/logger.js';
import { loadLocalConfig, saveLocalConfig, getAgentVersion } from '../config.js';
import { collectSystemInfo } from '../system/info.js';
import { collectTelemetry } from '../system/monitor.js';
import type { MiningManager } from '../mining/manager.js';
import type { MachineConfig, MiningStatus } from '@minefleet/shared-types';

const logger = createChildLogger('agent-client');

export interface HeartbeatTelemetry {
  cpuPercent: number;
  ramPercent: number;
  gpuPercent?: number | null;
  cpuTempC: number;
  gpuTempC?: number | null;
  hashrate: number;
  miningThreads: number;
  miningStatus: MiningStatus;
  powerWatts?: number | null;
  safetyState?: 'normal' | 'throttled' | 'paused_thermal' | 'paused_load';
}

export class AgentHttpClient {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private intervalMs = 15000; // 15 seconds default
  private cachedSystemInfo: any = null;
  private systemInfoSent = false;
  private failedAttempts = 0;
  private offlineTelemetryBuffer: HeartbeatTelemetry[] = [];

  constructor(
    private readonly controllerUrl: string,
    private readonly miningManager: MiningManager,
  ) {}

  /** Start the periodic heartbeat and telemetry loop */
  async start(intervalMs = 15000): Promise<void> {
    this.intervalMs = intervalMs;
    this.running = true;

    // Scan hardware once at startup
    try {
      this.cachedSystemInfo = await collectSystemInfo();
      logger.info({ hostname: this.cachedSystemInfo.hostname }, 'Hardware inventory indexed');
    } catch (err) {
      logger.warn({ err }, 'Failed initial hardware scan, will retry later');
    }

    // Execute first heartbeat immediately
    await this.tick();

    // Schedule regular heartbeat ticks
    this.scheduleNext();
    logger.info({ intervalMs: this.intervalMs }, 'Heartbeat loop active');
  }

  /** Stop the heartbeat loop */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Heartbeat loop stopped');
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.tick();
      this.scheduleNext();
    }, this.intervalMs);
  }

  /** One heartbeat tick */
  async tick(): Promise<void> {
    const localConfig = loadLocalConfig();
    if (!localConfig || !localConfig.apiToken) {
      logger.error('No API token found in local configuration. Cannot send heartbeat.');
      return;
    }

    // Collect lightweight telemetry
    let telemetry: HeartbeatTelemetry;
    try {
      const raw = await collectTelemetry();
      const status = this.miningManager.getStatus();
      telemetry = {
        cpuPercent: raw.cpuPercent,
        ramPercent: raw.ramPercent,
        gpuPercent: raw.gpuPercent ?? null,
        cpuTempC: raw.cpuTempC ?? 0,
        gpuTempC: raw.gpuTempC ?? null,
        hashrate: this.miningManager.getHashrate() || 0,
        miningThreads: raw.miningThreads || 0,
        miningStatus: status,
        powerWatts: raw.powerWatts ?? null,
        safetyState: 'normal',
      };
    } catch (err) {
      logger.warn({ err }, 'Failed collecting telemetry');
      return;
    }

    // Build payload
    const payload: Record<string, any> = {
      telemetry,
      configVersion: localConfig.lastConfigVersion || 0,
    };

    // Attach system info on initial heartbeat or when unacknowledged
    if (!this.systemInfoSent && this.cachedSystemInfo) {
      payload.systemInfo = this.cachedSystemInfo;
    }

    const endpoint = `${this.controllerUrl.replace(/\/+$/, '')}/api/machines/heartbeat`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localConfig.apiToken}`,
          'User-Agent': `MineFleetAgent/${getAgentVersion()}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json() as any;
      this.systemInfoSent = true;
      this.failedAttempts = 0;

      // Drain buffered telemetry on reconnect
      if (this.offlineTelemetryBuffer.length > 0) {
        this.offlineTelemetryBuffer = [];
      }

      // 1. Process updated configuration if returned
      if (json.data?.config) {
        await this.handleConfigUpdate(json.data.config);
      }

      // 2. Process queued commands
      if (Array.isArray(json.data?.commands) && json.data.commands.length > 0) {
        for (const cmd of json.data.commands) {
          await this.handleCommand(cmd);
        }
      }
    } catch (err: any) {
      this.failedAttempts++;
      logger.warn({ err: err.message, attempts: this.failedAttempts }, 'Heartbeat failed; operating in safe offline mode');

      // Buffer telemetry in memory (capped to max 100 points, ~10KB)
      this.offlineTelemetryBuffer.push(telemetry);
      if (this.offlineTelemetryBuffer.length > 100) {
        this.offlineTelemetryBuffer.shift();
      }
    }
  }

  private async handleConfigUpdate(config: MachineConfig): Promise<void> {
    logger.info({ version: config.version }, 'Applying updated configuration from controller');
    try {
      await this.miningManager.applyConfig(config);

      const localConfig = loadLocalConfig();
      if (localConfig) {
        localConfig.lastConfig = config;
        localConfig.lastConfigVersion = config.version;
        saveLocalConfig(localConfig);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to apply configuration update');
    }
  }

  private async handleCommand(cmd: { id: string; type: string; payload?: any }): Promise<void> {
    logger.info({ type: cmd.type }, 'Executing command from controller');
    try {
      switch (cmd.type) {
        case 'start':
          // Enable mining in config if not already enabled
          if (this.miningManager) {
            await this.miningManager.applyConfig({
              miningEnabled: true,
              cpuLimitPercent: 30,
              maxMiningThreads: 2,
              gpuEnabled: false,
              gpuSettings: [],
              workloadPolicy: 'conservative',
              pauseCpuAbove: 90,
              reduceCpuAbove: 75,
              resumeCpuBelow: 60,
              tempWarningC: 75,
              tempReduceC: 80,
              tempPauseC: 85,
              tempResumeC: 70,
              custom: {},
            } as any);
            await this.miningManager.start();
          }
          break;
        case 'stop':
          await this.miningManager.stop('controller_command');
          break;
        case 'pause':
          await this.miningManager.pause();
          break;
        case 'resume':
          await this.miningManager.resume();
          break;
        case 'update_config':
          if (cmd.payload?.config) {
            await this.handleConfigUpdate(cmd.payload.config);
          }
          break;
        default:
          logger.warn({ type: cmd.type }, 'Unrecognized command type');
      }
    } catch (err: any) {
      logger.error({ err: err.message, type: cmd.type }, 'Command execution error');
    }
  }
}
