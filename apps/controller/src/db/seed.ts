import { loadConfig } from '../config.js';
import { initPool, closePool, queryOne } from './pool.js';
import { hashPassword } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

async function seed() {
  const config = loadConfig();
  
  if (!config.admin.password) {
    logger.error('ADMIN_PASSWORD environment variable is required for seeding');
    process.exit(1);
  }

  await initPool(config.database.connectionString);

  // Check if admin exists
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [config.admin.email]);
  
  if (existing) {
    logger.info({ email: config.admin.email }, 'Admin user already exists, skipping seed');
  } else {
    const passwordHash = await hashPassword(config.admin.password);
    await queryOne(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES (gen_random_uuid(), $1, $2, 'admin')
       RETURNING id`,
      [config.admin.email, passwordHash],
    );
    logger.info({ email: config.admin.email }, 'Admin user created');
  }

  await closePool();
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
