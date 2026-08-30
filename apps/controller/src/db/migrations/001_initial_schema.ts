import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // uuid ossp extension for uuid generation
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  // 1. users
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    email: { type: 'varchar', unique: true, notNull: true },
    password_hash: { type: 'varchar', notNull: true },
    role: { type: 'varchar', notNull: true, default: 'admin' },
    totp_secret: { type: 'varchar', notNull: false },
    totp_enabled: { type: 'boolean', default: false },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 2. machine_groups
  pgm.createTable('machine_groups', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    name: { type: 'varchar', unique: true, notNull: true },
    description: { type: 'text' },
    default_config: { type: 'jsonb' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 3. machines
  pgm.createTable('machines', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    machine_uid: { type: 'varchar', unique: true, notNull: true },
    name: { type: 'varchar', notNull: true },
    hostname: { type: 'varchar', notNull: true },
    os: { type: 'varchar' },
    os_version: { type: 'varchar' },
    cpu_model: { type: 'varchar' },
    cpu_cores: { type: 'int' },
    cpu_threads: { type: 'int' },
    ram_bytes: { type: 'bigint' },
    gpus: { type: 'jsonb', default: '[]' },
    agent_version: { type: 'varchar' },
    ip_address: { type: 'varchar' },
    group_id: { type: 'uuid', references: 'machine_groups', onDelete: 'SET NULL' },
    status: { type: 'varchar', notNull: true, default: 'offline' },
    last_heartbeat: { type: 'timestamptz' },
    registered_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 4. machine_credentials
  pgm.createTable('machine_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE', unique: true, notNull: true },
    token_hash: { type: 'varchar', notNull: true },
    issued_at: { type: 'timestamptz', default: pgm.func('now()') },
    rotated_at: { type: 'timestamptz' },
    revoked: { type: 'boolean', default: false },
  });

  // 5. enrollment_tokens
  pgm.createTable('enrollment_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    token_hash: { type: 'varchar', notNull: true },
    label: { type: 'varchar' },
    target_group_id: { type: 'uuid', references: 'machine_groups', onDelete: 'SET NULL' },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    used_by_machine: { type: 'uuid', references: 'machines', onDelete: 'SET NULL' },
    revoked: { type: 'boolean', default: false },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 6. machine_configs
  pgm.createTable('machine_configs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE', unique: true, notNull: true },
    version: { type: 'int', notNull: true, default: 1 },
    mining_enabled: { type: 'boolean', default: false },
    cpu_limit_percent: { type: 'int', default: 20 },
    max_mining_threads: { type: 'int' },
    gpu_enabled: { type: 'boolean', default: false },
    gpu_settings: { type: 'jsonb', default: '[]' },
    workload_policy: { type: 'varchar', default: 'conservative' },
    pause_cpu_above: { type: 'int', default: 90 },
    reduce_cpu_above: { type: 'int', default: 75 },
    resume_cpu_below: { type: 'int', default: 60 },
    temp_warning_c: { type: 'int', default: 75 },
    temp_reduce_c: { type: 'int', default: 80 },
    temp_pause_c: { type: 'int', default: 85 },
    temp_resume_c: { type: 'int', default: 70 },
    pool_config: { type: 'jsonb' },
    custom: { type: 'jsonb', default: '{}' },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 7. group_configs
  pgm.createTable('group_configs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    group_id: { type: 'uuid', references: 'machine_groups', onDelete: 'CASCADE', unique: true, notNull: true },
    version: { type: 'int', default: 1 },
    config: { type: 'jsonb', notNull: true, default: '{}' },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 8. mining_sessions
  pgm.createTable('mining_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE', notNull: true },
    backend: { type: 'varchar', notNull: true },
    started_at: { type: 'timestamptz', default: pgm.func('now()') },
    stopped_at: { type: 'timestamptz' },
    stop_reason: { type: 'varchar' },
    avg_hashrate: { type: 'float' },
    avg_cpu_percent: { type: 'float' },
    avg_gpu_percent: { type: 'float' },
  });

  // 9. telemetry
  pgm.createTable('telemetry', {
    id: { type: 'bigserial', primaryKey: true },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE', notNull: true },
    cpu_percent: { type: 'float' },
    ram_percent: { type: 'float' },
    gpu_percent: { type: 'float' },
    cpu_temp_c: { type: 'float' },
    gpu_temp_c: { type: 'float' },
    hashrate: { type: 'float' },
    mining_threads: { type: 'int', default: 0 },
    mining_status: { type: 'varchar', default: 'idle' },
    power_watts: { type: 'float' },
    recorded_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 10. schedules
  pgm.createTable('schedules', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE' },
    group_id: { type: 'uuid', references: 'machine_groups', onDelete: 'CASCADE' },
    name: { type: 'varchar', notNull: true },
    cron_expression: { type: 'varchar' },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    days: { type: 'varchar' },
    config_override: { type: 'jsonb', notNull: true, default: '{}' },
    enabled: { type: 'boolean', default: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 11. audit_logs
  pgm.createTable('audit_logs', {
    id: { type: 'bigserial', primaryKey: true },
    user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'SET NULL' },
    action: { type: 'varchar', notNull: true },
    resource_type: { type: 'varchar', notNull: true },
    resource_id: { type: 'uuid' },
    details: { type: 'jsonb' },
    ip_address: { type: 'varchar' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 12. notifications
  pgm.createTable('notifications', {
    id: { type: 'bigserial', primaryKey: true },
    machine_id: { type: 'uuid', references: 'machines', onDelete: 'CASCADE' },
    severity: { type: 'varchar', notNull: true, default: 'info' },
    type: { type: 'varchar', notNull: true },
    title: { type: 'varchar', notNull: true },
    message: { type: 'text' },
    read: { type: 'boolean', default: false },
    dismissed: { type: 'boolean', default: false },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // 13. settings
  pgm.createTable('settings', {
    key: { type: 'varchar', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Indexes
  pgm.sql(`
    CREATE INDEX idx_telemetry_machine_time ON telemetry (machine_id, recorded_at DESC);
    CREATE INDEX idx_telemetry_recorded_at ON telemetry (recorded_at);
    CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC);
    CREATE INDEX idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
    CREATE INDEX idx_notifications_machine ON notifications (machine_id, created_at DESC);
    CREATE INDEX idx_notifications_unread ON notifications (read, created_at DESC) WHERE read = false;
    CREATE INDEX idx_machines_status ON machines (status);
    CREATE INDEX idx_machines_group ON machines (group_id);
    CREATE INDEX idx_enrollment_tokens_hash ON enrollment_tokens (token_hash) WHERE used_at IS NULL AND revoked = false;
    CREATE INDEX idx_mining_sessions_machine ON mining_sessions (machine_id, started_at DESC);
  `);

  // Seeds
  pgm.sql(`
    INSERT INTO settings (key, value) VALUES
      ('electricity_price_per_kwh', '{"value": 0.12}'),
      ('telemetry_retention_days', '{"value": 30}'),
      ('default_currency', '{"value": "USD"}')
    ON CONFLICT (key) DO NOTHING;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('settings');
  pgm.dropTable('notifications');
  pgm.dropTable('audit_logs');
  pgm.dropTable('schedules');
  pgm.dropTable('telemetry');
  pgm.dropTable('mining_sessions');
  pgm.dropTable('group_configs');
  pgm.dropTable('machine_configs');
  pgm.dropTable('enrollment_tokens');
  pgm.dropTable('machine_credentials');
  pgm.dropTable('machines');
  pgm.dropTable('machine_groups');
  pgm.dropTable('users');
  
  pgm.dropExtension('uuid-ossp');
}
