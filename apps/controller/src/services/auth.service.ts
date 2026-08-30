import { getStorage } from '../storage/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { signJwt, verifyJwt, type JwtPayload } from '../middleware/auth.js';
import { UnauthorizedError } from '../utils/errors.js';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

const logger = createChildLogger('auth');

export async function login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: { id: string; email: string; role: string } }> {
  const storage = getStorage();
  const normalizedEmail = email.toLowerCase().trim();
  let user = await storage.getUserByEmail(normalizedEmail);

  // Auto-seed default admin user on first login if no users exist
  if (!user) {
    const config = loadConfig();
    const allUsers = await storage.listUsers();
    if (allUsers.length === 0 && config.admin.email && config.admin.password) {
      if (normalizedEmail === config.admin.email.toLowerCase().trim()) {
        const passwordHash = await hashPassword(config.admin.password);
        user = {
          id: randomUUID(),
          email: config.admin.email,
          passwordHash,
          role: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.saveUser(user);
        logger.info({ email: user.email }, 'Initialized default admin account');
      }
    }
  }

  if (!user) {
    logger.warn({ email: normalizedEmail }, 'Login attempt for non-existent user');
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    logger.warn({ email: normalizedEmail }, 'Login attempt with wrong password');
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

  logger.info({ email: user.email, userId: user.id }, 'User logged in');

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role },
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const config = loadConfig();
  const storage = getStorage();

  let payload: JwtPayload;
  try {
    payload = verifyJwt(refreshToken, config.jwt.refreshSecret);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (payload.type !== 'refresh') {
    throw new UnauthorizedError('Invalid token type');
  }

  const user = await storage.getUserById(payload.sub);
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
