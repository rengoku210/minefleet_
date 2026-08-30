import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { loadConfig } from '../config.js';
import { createHmac } from 'node:crypto';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: 'admin' | 'viewer';
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

// Simple JWT implementation using Node.js crypto
function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString();
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresIn: string): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiry(expiresIn);
  
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Invalid token format');
  }

  const [header, body, signature] = parts;
  const expectedSignature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    throw new UnauthorizedError('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(body)) as JwtPayload;

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError('Token expired');
  }

  return payload;
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
  
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown time unit: ${match[2]}`);
  }
}

/** Fastify preHandler hook to require authentication */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  const config = loadConfig();
  
  try {
    const payload = verifyJwt(token, config.jwt.secret);
    if (payload.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }
    // Attach user info to request
    (request as any).user = payload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/** Fastify preHandler hook to require admin role */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  const user = (request as any).user as JwtPayload;
  if (user.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
}
