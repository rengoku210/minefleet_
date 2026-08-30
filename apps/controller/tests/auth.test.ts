import { describe, it, expect, beforeAll } from 'vitest';
import { signJwt, verifyJwt } from '../src/middleware/auth.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../src/utils/crypto.js';

describe('JWT', () => {
  const secret = 'test-secret-key-for-jwt';

  it('should sign and verify a token', () => {
    const token = signJwt(
      { sub: 'user-1', email: 'test@test.com', role: 'admin', type: 'access' },
      secret,
      '15m',
    );

    expect(token).toBeDefined();
    expect(token.split('.')).toHaveLength(3);

    const payload = verifyJwt(token, secret);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('test@test.com');
    expect(payload.role).toBe('admin');
    expect(payload.type).toBe('access');
  });

  it('should reject token with wrong secret', () => {
    const token = signJwt(
      { sub: 'user-1', email: 'test@test.com', role: 'admin', type: 'access' },
      secret,
      '15m',
    );

    expect(() => verifyJwt(token, 'wrong-secret')).toThrow();
  });

  it('should reject expired tokens', async () => {
    const token = signJwt(
      { sub: 'user-1', email: 'test@test.com', role: 'admin', type: 'access' },
      secret,
      '1s', // expires in 1 second
    );

    // Wait for token to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(() => verifyJwt(token, secret)).toThrow('Token expired');
  });

  it('should reject invalid token format', () => {
    expect(() => verifyJwt('invalid', secret)).toThrow();
    expect(() => verifyJwt('a.b', secret)).toThrow();
    expect(() => verifyJwt('', secret)).toThrow();
  });

  it('should parse different expiry formats', () => {
    const formats = ['30s', '15m', '1h', '7d'];
    for (const fmt of formats) {
      const token = signJwt(
        { sub: 'user-1', email: 'test@test.com', role: 'admin', type: 'access' },
        secret,
        fmt,
      );
      const payload = verifyJwt(token, secret);
      expect(payload.exp).toBeGreaterThan(payload.iat);
    }
  });
});

describe('Password Hashing', () => {
  it('should hash and verify a password', async () => {
    const hash = await hashPassword('my-secure-password');
    expect(hash).toBeDefined();
    expect(hash).not.toBe('my-secure-password');

    const valid = await verifyPassword('my-secure-password', hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('wrong-password', hash);
    expect(invalid).toBe(false);
  });

  it('should generate different hashes for same password', async () => {
    const hash1 = await hashPassword('password');
    const hash2 = await hashPassword('password');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Token Generation', () => {
  it('should generate unique tokens', () => {
    const t1 = generateToken('test');
    const t2 = generateToken('test');
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^test_[a-f0-9]{64}$/);
  });

  it('should hash tokens deterministically', () => {
    const token = 'test_abc123';
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(token);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it('should produce different hashes for different tokens', () => {
    const h1 = hashToken('token1');
    const h2 = hashToken('token2');
    expect(h1).not.toBe(h2);
  });
});
