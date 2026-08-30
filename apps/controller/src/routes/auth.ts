import type { FastifyInstance } from 'fastify';
import { login, refreshAccessToken } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import type { JwtPayload } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  app.post<{ Body: { email: string; password: string } }>('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' },
      });
    }

    const result = await login(email, password);

    // Set refresh token as httpOnly cookie
    reply.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    await auditLog(request, 'login', 'user', result.user.id);

    return reply.send({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  });

  // POST /api/auth/refresh
  app.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;
    if (!refreshToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No refresh token' },
      });
    }

    const result = await refreshAccessToken(refreshToken);

    return reply.send({
      success: true,
      data: { accessToken: result.accessToken },
    });
  });

  // POST /api/auth/logout
  app.post('/logout', async (request, reply) => {
    reply.clearCookie('refreshToken', {
      path: '/api/auth/refresh',
    });

    return reply.send({ success: true });
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = (request as any).user as JwtPayload;
    return reply.send({
      success: true,
      data: {
        id: user.sub,
        email: user.email,
        role: user.role,
      },
    });
  });
}
