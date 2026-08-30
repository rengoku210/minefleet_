import { describe, it, expect } from 'vitest';
import {
  createMessage,
  isAgentMessage,
  isControllerMessage,
  AGENT_AUTH,
  CTRL_AUTH_RESULT,
  HEARTBEAT_INTERVAL_MS,
  TELEMETRY_INTERVAL_MS,
  RECONNECT_DELAYS_MS,
  PROTOCOL_VERSION,
} from '@minefleet/protocol';

describe('Protocol Messages', () => {
  it('should create messages with proper structure', () => {
    const msg = createMessage('agent:auth', { machineUid: 'test', apiToken: 'token' });
    expect(msg.type).toBe('agent:auth');
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.id).toBeDefined();
    expect(msg.payload).toEqual({ machineUid: 'test', apiToken: 'token' });
  });

  it('should generate unique message IDs', () => {
    const msg1 = createMessage('test', {});
    const msg2 = createMessage('test', {});
    expect(msg1.id).not.toBe(msg2.id);
  });

  it('should correctly identify agent messages', () => {
    expect(isAgentMessage({ type: 'agent:auth', timestamp: 0, payload: {} })).toBe(true);
    expect(isAgentMessage({ type: 'agent:heartbeat', timestamp: 0, payload: {} })).toBe(true);
    expect(isAgentMessage({ type: 'ctrl:ping', timestamp: 0, payload: {} })).toBe(false);
  });

  it('should correctly identify controller messages', () => {
    expect(isControllerMessage({ type: 'ctrl:auth_result', timestamp: 0, payload: {} })).toBe(true);
    expect(isControllerMessage({ type: 'ctrl:config_update', timestamp: 0, payload: {} })).toBe(true);
    expect(isControllerMessage({ type: 'agent:auth', timestamp: 0, payload: {} })).toBe(false);
  });
});

describe('Protocol Constants', () => {
  it('should have valid protocol version', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have reasonable timing constants', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(TELEMETRY_INTERVAL_MS).toBe(10_000);
  });

  it('should have exponential backoff delays', () => {
    expect(RECONNECT_DELAYS_MS).toHaveLength(6);
    for (let i = 1; i < RECONNECT_DELAYS_MS.length; i++) {
      expect(RECONNECT_DELAYS_MS[i]).toBeGreaterThanOrEqual(RECONNECT_DELAYS_MS[i - 1]);
    }
    // Max delay should be 30s
    expect(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]).toBe(30_000);
  });

  it('should have message type constants', () => {
    expect(AGENT_AUTH).toBe('agent:auth');
    expect(CTRL_AUTH_RESULT).toBe('ctrl:auth_result');
  });
});
