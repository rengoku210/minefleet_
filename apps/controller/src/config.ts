import { readFileSync } from 'node:fs';

export interface AppConfig {
  host: string;
  port: number;
  controllerUrl: string;
  database: {
    connectionString: string;
  };
  jwt: {
    secret: string;
    refreshSecret: string;
    accessExpiry: string;
    refreshExpiry: string;
  };
  admin: {
    email: string;
    password: string;
  };
  nodeEnv: string;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function loadConfig(): AppConfig {
  return {
    host: optionalEnv('CONTROLLER_HOST', '0.0.0.0'),
    port: parseInt(optionalEnv('CONTROLLER_PORT', '3001'), 10),
    controllerUrl: optionalEnv('CONTROLLER_URL', 'http://localhost:3001'),
    database: {
      connectionString: requireEnv('DATABASE_URL'),
    },
    jwt: {
      secret: requireEnv('JWT_SECRET'),
      refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
      accessExpiry: optionalEnv('JWT_ACCESS_EXPIRY', '15m'),
      refreshExpiry: optionalEnv('JWT_REFRESH_EXPIRY', '7d'),
    },
    admin: {
      email: optionalEnv('ADMIN_EMAIL', 'admin@minefleet.local'),
      password: optionalEnv('ADMIN_PASSWORD', ''),
    },
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
  };
}
