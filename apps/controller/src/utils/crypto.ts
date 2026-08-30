import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/** Generate a cryptographically secure random token */
export function generateToken(prefix = 'mf'): string {
  const bytes = randomBytes(32);
  return `${prefix}_${bytes.toString('hex')}`;
}

/** Hash a token with SHA-256 for storage (for high-entropy tokens) */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Hash a password with bcrypt */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verify a password against a bcrypt hash */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a unique machine UID */
export function generateMachineUid(): string {
  const bytes = randomBytes(16);
  return `machine_${bytes.toString('hex')}`;
}
