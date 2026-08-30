import WebSocket from 'ws';
import { createChildLogger } from '../utils/logger.js';
import { RECONNECT_DELAYS_MS, HEARTBEAT_INTERVAL_MS, TELEMETRY_INTERVAL_MS } from '@minefleet/protocol';
import type { WSMessage } from '@minefleet/protocol';

const logger = createChildLogger('websocket');

export type MessageHandler = (message: WSMessage) => void;

export class AgentWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private messageHandler: MessageHandler | null = null;
  private onConnected: (() => void) | null = null;
  private onDisconnected: (() => void) | null = null;

  constructor(
    private readonly controllerUrl: string,
  ) {}

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  setOnConnected(handler: () => void): void {
    this.onConnected = handler;
  }

  setOnDisconnected(handler: () => void): void {
    this.onDisconnected = handler;
  }

  connect(): void {
    if (this.isShuttingDown) return;

    const wsUrl = this.controllerUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + '/ws/v1/agent';

    logger.info({ url: wsUrl, attempt: this.reconnectAttempt }, 'Connecting to controller');

    try {
      this.ws = new WebSocket(wsUrl, {
        handshakeTimeout: 10_000,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create WebSocket');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('Connected to controller');
      this.reconnectAttempt = 0;
      this.onConnected?.();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        this.messageHandler?.(message);
      } catch (err) {
        logger.error({ err }, 'Failed to parse message');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'Connection closed');
      this.cleanup();
      this.onDisconnected?.();
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, 'WebSocket error');
    });
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn({ type: message.type }, 'Cannot send, not connected');
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  startHeartbeat(getPayload: () => any): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({
          type: 'agent:heartbeat',
          timestamp: Date.now(),
          payload: getPayload(),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  startTelemetry(getPayload: () => Promise<any>): void {
    this.stopTelemetry();
    this.telemetryInterval = setInterval(async () => {
      if (this.isConnected()) {
        const payload = await getPayload();
        this.send({
          type: 'agent:telemetry',
          timestamp: Date.now(),
          payload,
        });
      }
    }, TELEMETRY_INTERVAL_MS);
  }

  stopTelemetry(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  shutdown(): void {
    this.isShuttingDown = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
      this.ws = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.stopTelemetry();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    const delayIndex = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[delayIndex];

    logger.info({ delay, attempt: this.reconnectAttempt + 1 }, 'Scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }
}
