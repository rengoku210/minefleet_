import pino from 'pino';
import { platform } from 'node:os';
import { join } from 'node:path';

function getLogPath(): string {
  if (platform() === 'win32') {
    return join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MineFleet', 'logs', 'agent.log');
  }
  return '/var/log/minefleet/agent.log';
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
