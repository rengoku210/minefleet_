import { queryOne } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { signJwt, type JwtPayload } from '../middleware/auth.js';
import { UnauthorizedError } from '../utils/errors.js';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('auth');

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
}

export async function login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: { id: string; email: string; role: string } }> {
  const user = await queryOne<UserRow>(
    'SELECT id, email, password_hash, role FROM users WHERE email = $1',
    [email],
  );

  if (!user) {
    logger.warn({ email }, 'Login attempt for non-existent user');
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    logger.warn({ email }, 'Login attempt with wrong password');
    throw new UnauthorizedError('Invalid email or password');
  }

  const config = loadConfig();

  const accessToken = signJwt(
    { sub: user.id, email: user.email, role: user.role as 'admin' | 'viewer', type: 'access' },
    config.jwt.secret,
    config.jwt.accessExpiry,
  );

  const refreshToken = signJwt(
    { sub: user.id, email: user.email, role: user.role as 'admin' | 'viewer', type: 'refresh' },
    config.jwt.refreshSecret,
    config.jwt.refreshExpiry,
  );

  logger.info({ email, userId: user.id }, 'User logged in');

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role },
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const config = loadConfig();
  
  // Import verifyJwt here to avoid circular
  const { verifyJwt } = await import('../middleware/auth.js');
  
  let payload: JwtPayload;
  try {
    payload = verifyJwt(refreshToken, config.jwt.refreshSecret);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (payload.type !== 'refresh') {
    throw new UnauthorizedError('Invalid token type');
  }

  // Verify user still exists
  const user = await queryOne<UserRow>(
    'SELECT id, email, role FROM users WHERE id = $1',
    [payload.sub],
  );

  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }

  const accessToken = signJwt(
    { sub: user.id, email: user.email, role: user.role as 'admin' | 'viewer', type: 'access' },
    config.jwt.secret,
    config.jwt.accessExpiry,
  );

  return { accessToken };
}
