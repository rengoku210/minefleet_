import { query, queryOne } from './pool.js';
import { hashPassword } from '../utils/crypto.js';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('db-schema');

export async function initDatabaseSchema(): Promise<void> {
  logger.info('Checking and initializing database schema...');

  // Extensions
  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Tables
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR UNIQUE NOT NULL,
      password_hash VARCHAR NOT NULL,
      role VARCHAR NOT NULL DEFAULT 'admin',
      totp_secret VARCHAR,
      totp_enabled BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS machine_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR UNIQUE NOT NULL,
      description TEXT,
      default_config JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS machines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_uid VARCHAR UNIQUE NOT NULL,
      name VARCHAR NOT NULL,
      hostname VARCHAR NOT NULL,
      os VARCHAR,
      os_version VARCHAR,
      cpu_model VARCHAR,
      cpu_cores INT,
      cpu_threads INT,
      ram_bytes BIGINT,
      gpus JSONB DEFAULT '[]',
      agent_version VARCHAR,
      ip_address VARCHAR,
      group_id UUID REFERENCES machine_groups ON DELETE SET NULL,
      status VARCHAR NOT NULL DEFAULT 'offline',
      last_heartbeat TIMESTAMPTZ,
      registered_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS machine_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id UUID REFERENCES machines ON DELETE CASCADE UNIQUE NOT NULL,
      token_hash VARCHAR NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT now(),
      rotated_at TIMESTAMPTZ,
      revoked BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by UUID REFERENCES users ON DELETE SET NULL,
      token_hash VARCHAR NOT NULL,
      label VARCHAR,
      target_group_id UUID REFERENCES machine_groups ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      used_by_machine UUID REFERENCES machines ON DELETE SET NULL,
      revoked BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS machine_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id UUID REFERENCES machines ON DELETE CASCADE UNIQUE NOT NULL,
      version INT NOT NULL DEFAULT 1,
      mining_enabled BOOLEAN DEFAULT false,
      cpu_limit_percent INT DEFAULT 20,
      max_mining_threads INT,
      gpu_enabled BOOLEAN DEFAULT false,
      gpu_settings JSONB DEFAULT '[]',
      workload_policy VARCHAR DEFAULT 'conservative',
      pause_cpu_above INT DEFAULT 90,
      reduce_cpu_above INT DEFAULT 75,
      resume_cpu_below INT DEFAULT 60,
      temp_warning_c INT DEFAULT 75,
      temp_reduce_c INT DEFAULT 80,
      temp_pause_c INT DEFAULT 85,
      temp_resume_c INT DEFAULT 70,
      pool_config JSONB,
      custom JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS group_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES machine_groups ON DELETE CASCADE UNIQUE NOT NULL,
      version INT DEFAULT 1,
      config JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mining_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id UUID REFERENCES machines ON DELETE CASCADE NOT NULL,
      backend VARCHAR NOT NULL,
      started_at TIMESTAMPTZ DEFAULT now(),
      stopped_at TIMESTAMPTZ,
      stop_reason VARCHAR,
      avg_hashrate FLOAT,
      avg_cpu_percent FLOAT,
      avg_gpu_percent FLOAT
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id BIGSERIAL PRIMARY KEY,
      machine_id UUID REFERENCES machines ON DELETE CASCADE NOT NULL,
      cpu_percent FLOAT,
      ram_percent FLOAT,
      gpu_percent FLOAT,
      cpu_temp_c FLOAT,
      gpu_temp_c FLOAT,
      hashrate FLOAT,
      mining_threads INT DEFAULT 0,
      mining_status VARCHAR DEFAULT 'idle',
      power_watts FLOAT,
      recorded_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id UUID REFERENCES machines ON DELETE CASCADE,
      group_id UUID REFERENCES machine_groups ON DELETE CASCADE,
      name VARCHAR NOT NULL,
      cron_expression VARCHAR,
      start_time TIME,
      end_time TIME,
      days VARCHAR,
      config_override JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users ON DELETE SET NULL,
      machine_id UUID REFERENCES machines ON DELETE SET NULL,
      action VARCHAR NOT NULL,
      resource_type VARCHAR NOT NULL,
      resource_id UUID,
      details JSONB,
      ip_address VARCHAR,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      machine_id UUID REFERENCES machines ON DELETE CASCADE,
      severity VARCHAR NOT NULL DEFAULT 'info',
      type VARCHAR NOT NULL,
      title VARCHAR NOT NULL,
      message TEXT,
      read BOOLEAN DEFAULT false,
      dismissed BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Indexes
  await query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_machine_time ON telemetry (machine_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON telemetry (recorded_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_machine ON notifications (machine_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_machines_status ON machines (status);
    CREATE INDEX IF NOT EXISTS idx_machines_group ON machines (group_id);
    CREATE INDEX IF NOT EXISTS idx_mining_sessions_machine ON mining_sessions (machine_id, started_at DESC);
  `);

  // Seed default settings
  await query(`
    INSERT INTO settings (key, value) VALUES
      ('electricity_price_per_kwh', '{"value": 0.12}'),
      ('telemetry_retention_days', '{"value": 30}'),
      ('default_currency', '{"value": "USD"}')
    ON CONFLICT (key) DO NOTHING;
  `);

  // Seed default admin user if none exists
  const config = loadConfig();
  const existingUser = await queryOne('SELECT id FROM users LIMIT 1');
  if (!existingUser && config.admin.email && config.admin.password) {
    const passwordHash = await hashPassword(config.admin.password);
    await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO NOTHING;`,
      [config.admin.email, passwordHash],
    );
    logger.info({ email: config.admin.email }, 'Admin user initialized');
  }

  logger.info('Database schema and initial seeds ready');
}
