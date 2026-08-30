import type { WSMessage, CtrlConfigUpdatePayload, CtrlCommandPayload } from '@minefleet/protocol';
import { PROTOCOL_VERSION } from '@minefleet/protocol';
import { createChildLogger } from '../utils/logger.js';
import { loadLocalConfig, saveLocalConfig, getAgentVersion } from '../config.js';
import { collectSystemInfo } from '../system/info.js';
import { collectTelemetry } from '../system/monitor.js';
import type { AgentWebSocket } from './websocket.js';
import type { MiningManager } from '../mining/manager.js';

const logger = createChildLogger('protocol');

export class ProtocolHandler {
  private authenticated = false;
  private machineId: string | null = null;

  constructor(
    private readonly ws: AgentWebSocket,
    private readonly miningManager: MiningManager,
  ) {}

  async handleMessage(msg: WSMessage): Promise<void> {
    switch (msg.type) {
      case 'ctrl:auth_result':
        await this.handleAuthResult(msg.payload as any);
        break;
      case 'ctrl:config_update':
        await this.handleConfigUpdate(msg.payload as CtrlConfigUpdatePayload);
        break;
      case 'ctrl:command':
        await this.handleCommand(msg.payload as CtrlCommandPayload);
        break;
      case 'ctrl:ping':
        // No response needed, heartbeat handles keepalive
        break;
      default:
        logger.warn({ type: msg.type }, 'Unknown message type');
    }
  }

  async authenticate(): Promise<void> {
    const config = loadLocalConfig();
    if (!config) {
      logger.error('No local config found, cannot authenticate');
      return;
    }

    this.ws.send({
      type: 'agent:auth',
      timestamp: Date.now(),
      payload: {
        machineUid: config.machineUid,
        apiToken: config.apiToken,
        protocolVersion: PROTOCOL_VERSION,
        agentVersion: getAgentVersion(),
      },
    });
  }

  private async handleAuthResult(payload: { success: boolean; error?: string; machineId?: string }): Promise<void> {
    if (!payload.success) {
      logger.error({ error: payload.error }, 'Authentication failed');
      return;
    }

    this.authenticated = true;
    this.machineId = payload.machineId || null;
    logger.info({ machineId: this.machineId }, 'Authenticated with controller');

    // Send system info
    const systemInfo = await collectSystemInfo();
    this.ws.send({
      type: 'agent:system_info',
      timestamp: Date.now(),
      payload: systemInfo,
    });

    // Start heartbeat
    const localConfig = loadLocalConfig();
    this.ws.startHeartbeat(() => ({
      uptime: process.uptime(),
      configVersion: localConfig?.lastConfigVersion || 0,
    }));

    // Start telemetry
    this.ws.startTelemetry(() => collectTelemetry());
  }

  private async handleConfigUpdate(payload: CtrlConfigUpdatePayload): Promise<void> {
    logger.info({ version: payload.version }, 'Received config update');

    try {
      // Apply config to mining manager
      await this.miningManager.applyConfig(payload.config);

      // Save config locally
      const localConfig = loadLocalConfig();
      if (localConfig) {
        localConfig.lastConfig = payload.config;
        localConfig.lastConfigVersion = payload.version;
        saveLocalConfig(localConfig);
      }

      // Acknowledge
      this.ws.send({
        type: 'agent:config_ack',
        timestamp: Date.now(),
        payload: {
          configVersion: payload.version,
          success: true,
        },
      });

      logger.info({ version: payload.version }, 'Config applied successfully');
    } catch (err: any) {
      logger.error({ err, version: payload.version }, 'Failed to apply config');
      this.ws.send({
        type: 'agent:config_ack',
        timestamp: Date.now(),
        payload: {
          configVersion: payload.version,
          success: false,
          error: err.message,
        },
      });
    }
  }

  private async handleCommand(payload: CtrlCommandPayload): Promise<void> {
    logger.info({ action: payload.action }, 'Received command');

    try {
      switch (payload.action) {
        case 'start':
          await this.miningManager.start();
          break;
        case 'stop':
          await this.miningManager.stop('user');
          break;
        case 'pause':
          await this.miningManager.pause();
          break;
        case 'resume':
          await this.miningManager.resume();
          break;
      }

      this.ws.send({
        type: 'agent:mining_event',
        timestamp: Date.now(),
        payload: {
          event: payload.action === 'start' ? 'started' :
                 payload.action === 'stop' ? 'stopped' :
                 payload.action === 'pause' ? 'paused' : 'resumed',
          reason: 'user_command',
        },
      });
    } catch (err: any) {
      logger.error({ err, action: payload.action }, 'Failed to execute command');
      this.ws.send({
        type: 'agent:mining_event',
        timestamp: Date.now(),
        payload: {
          event: 'error',
          reason: err.message,
        },
      });
    }
  }
}
