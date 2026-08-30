import si from 'systeminformation';
import { hostname, platform, release, cpus, totalmem } from 'node:os';
import type { MachineSystemInfo, GpuInfo } from '@minefleet/shared-types';
import { getAgentVersion } from '../config.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('system-info');

export async function collectSystemInfo(): Promise<MachineSystemInfo> {
  try {
    const [osInfo, cpuInfo, graphics] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.graphics(),
    ]);

    const gpus: GpuInfo[] = graphics.controllers
      .filter(g => g.model && g.model !== 'Unknown')
      .map((g, i) => ({
        index: i,
        name: g.model || 'Unknown',
        vendor: g.vendor || 'Unknown',
        memoryTotal: g.vram || 0,
        driver: g.driverVersion || undefined,
      }));

    return {
      hostname: hostname(),
      os: osInfo.platform || platform(),
      osVersion: osInfo.distro ? `${osInfo.distro} ${osInfo.release}` : release(),
      cpuModel: cpuInfo.brand || cpus()[0]?.model || 'Unknown',
      cpuCores: cpuInfo.physicalCores || cpus().length,
      cpuThreads: cpuInfo.cores || cpus().length,
      ramBytes: totalmem(),
      gpus,
      agentVersion: getAgentVersion(),
    };
  } catch (err) {
    logger.error({ err }, 'Failed to collect system info, using fallback');
    return {
      hostname: hostname(),
      os: platform(),
      osVersion: release(),
      cpuModel: cpus()[0]?.model || 'Unknown',
      cpuCores: cpus().length,
      cpuThreads: cpus().length,
      ramBytes: totalmem(),
      gpus: [],
      agentVersion: getAgentVersion(),
    };
  }
}
