import { randomBytes, createHash } from 'node:crypto';
import { hostname, cpus, platform, arch, totalmem } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

/** Generate a stable machine UID based on hardware characteristics */
export function generateMachineUid(): string {
  // Try to use machine-id on Linux
  if (platform() !== 'win32') {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      if (existsSync(path)) {
        try {
          const id = readFileSync(path, 'utf-8').trim();
          if (id) return `mf_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
        } catch {
          // fall through
        }
      }
    }
  }

  // Fallback: hash hostname + cpu + arch + total memory
  const fingerprint = [
    hostname(),
    cpus()[0]?.model || 'unknown',
    platform(),
    arch(),
    totalmem().toString(),
  ].join('|');

  return `mf_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}
