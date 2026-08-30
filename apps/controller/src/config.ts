export interface AppConfig {
  host: string;
  port: number;
  controllerUrl: string;
  storage: {
    redisUrl?: string;
    redisToken?: string;
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

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function loadConfig(): AppConfig {
  return {
    host: optionalEnv('CONTROLLER_HOST', '0.0.0.0'),
    port: parseInt(optionalEnv('CONTROLLER_PORT', optionalEnv('PORT', '3001')), 10),
    controllerUrl: optionalEnv('CONTROLLER_URL', optionalEnv('VERCEL_URL', 'http://localhost:3001')),
    storage: {
      redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    },
    jwt: {
      secret: optionalEnv('JWT_SECRET', 'minefleet_default_jwt_secret_change_in_production_xyz123'),
      refreshSecret: optionalEnv('JWT_REFRESH_SECRET', 'minefleet_default_refresh_secret_change_in_production_abc456'),
      accessExpiry: optionalEnv('JWT_ACCESS_EXPIRY', '15m'),
      refreshExpiry: optionalEnv('JWT_REFRESH_EXPIRY', '7d'),
    },
    admin: {
      email: optionalEnv('ADMIN_EMAIL', 'admin@minefleet.local'),
      password: optionalEnv('ADMIN_PASSWORD', 'Admin1234!'),
    },
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
  };
}
