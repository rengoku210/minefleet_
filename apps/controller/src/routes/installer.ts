import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('installer-routes');

export async function installerRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();

  // Helper to find file across dev and prod paths
  const findFile = (relPaths: string[]): string | null => {
    for (const rel of relPaths) {
      const p = join(process.cwd(), rel);
      if (existsSync(p)) return p;
    }
    return null;
  };

  // GET /install.ps1 - Dynamic PowerShell installer
  app.get<{ Querystring: { token?: string; controller?: string } }>('/install.ps1', async (request, reply) => {
    const { token = '', controller = '' } = request.query;
    const effectiveController = controller || config.controllerUrl || `${request.protocol}://${request.hostname}`;

    const scriptPath = findFile(['installer/install.ps1', '../../installer/install.ps1']);
    let script = '';
    if (scriptPath) {
      script = readFileSync(scriptPath, 'utf-8');
    } else {
      script = `# MineFleet Windows Installer fallback\nWrite-Host "MineFleet Installer";`;
    }

    // If token or controller passed in query, inject default parameter values into script header
    if (token || effectiveController) {
      let injectedDefaults = '';
      if (token) {
        injectedDefaults += `\nif (-not $Token) { $Token = "${token}" }`;
      }
      if (effectiveController) {
        injectedDefaults += `\nif (-not $Controller) { $Controller = "${effectiveController}" }`;
      }
      script = script.replace(/param\s*\([\s\S]*?\)/i, (match) => `${match}${injectedDefaults}`);
    }

    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  });

  // GET /install.sh - Dynamic Linux installer
  app.get<{ Querystring: { token?: string; controller?: string } }>('/install.sh', async (request, reply) => {
    const { token = '', controller = '' } = request.query;
    const effectiveController = controller || config.controllerUrl || `${request.protocol}://${request.hostname}`;

    const scriptPath = findFile(['installer/install.sh', '../../installer/install.sh']);
    let script = '';
    if (scriptPath) {
      script = readFileSync(scriptPath, 'utf-8');
    } else {
      script = `#!/usr/bin/env bash\necho "MineFleet Installer"`;
    }

    // Inject defaults if present
    if (token || effectiveController) {
      let injected = '\n# Server-injected parameters\n';
      if (token) injected += `[ -z "$TOKEN" ] && TOKEN="${token}"\n`;
      if (effectiveController) injected += `[ -z "$CONTROLLER_URL" ] && CONTROLLER_URL="${effectiveController}"\n`;
      script = script.replace('# Parse arguments', `${injected}\n# Parse arguments`);
    }

    return reply
      .header('Content-Type', 'text/x-shellscript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(script);
  });

  // GET /api/agent/bundle - Download agent JavaScript bundle
  app.get('/api/agent/bundle', async (request, reply) => {
    const bundlePath = findFile([
      'apps/agent/dist/index.js',
      '../agent/dist/index.js',
      '../../apps/agent/dist/index.js',
    ]);

    if (!bundlePath) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Agent bundle not found. Run pnpm build first.' } });
    }

    const content = readFileSync(bundlePath, 'utf-8');
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="minefleet-agent.js"')
      .send(content);
  });

  // GET /api/agent/download - Download agent binary
  app.get<{ Querystring: { os?: string; arch?: string } }>('/api/agent/download', async (request, reply) => {
    const { os = 'windows', arch = 'x86_64' } = request.query;
    const binaryExt = os === 'windows' ? '.exe' : '';
    const binPath = findFile([
      `apps/agent/dist/minefleet-agent${binaryExt}`,
      `../agent/dist/minefleet-agent${binaryExt}`,
      `../../apps/agent/dist/minefleet-agent${binaryExt}`,
    ]);

    if (binPath) {
      const buffer = readFileSync(binPath);
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="minefleet-agent${binaryExt}"`)
        .send(buffer);
    }

    // If native binary is not pre-compiled, redirect to JS bundle
    return reply.redirect('/api/agent/bundle');
  });
}
