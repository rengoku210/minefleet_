import si from 'systeminformation';
import type { TelemetrySnapshot, MiningStatus } from '@minefleet/shared-types';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('monitor');

let currentMiningStatus: MiningStatus = 'idle';
let currentMiningThreads = 0;
let currentHashrate: number | null = null;

export function setMiningState(status: MiningStatus, threads: number, hashrate: number | null): void {
  currentMiningStatus = status;
  currentMiningThreads = threads;
  currentHashrate = hashrate;
}

export async function collectTelemetry(): Promise<TelemetrySnapshot> {
  try {
    const [load, mem, cpuTemp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
    ]);

    // Try GPU metrics
    let gpuPercent: number | null = null;
    let gpuTempC: number | null = null;
    try {
      const graphics = await si.graphics();
      if (graphics.controllers.length > 0) {
        const gpu = graphics.controllers[0];
        gpuPercent = gpu.utilizationGpu ?? null;
        gpuTempC = gpu.temperatureGpu ?? null;
      }
    } catch {
      // GPU metrics not available
    }

    return {
      cpuPercent: Math.round(load.currentLoad * 100) / 100,
      ramPercent: Math.round((mem.used / mem.total) * 10000) / 100,
      gpuPercent,
      cpuTempC: cpuTemp.main ?? null,
      gpuTempC,
      hashrate: currentHashrate,
      miningThreads: currentMiningThreads,
      miningStatus: currentMiningStatus,
      powerWatts: null, // Will be estimated by mining backend
    };
  } catch (err) {
    logger.error({ err }, 'Failed to collect telemetry');
    return {
      cpuPercent: 0,
      ramPercent: 0,
      gpuPercent: null,
      cpuTempC: null,
      gpuTempC: null,
      hashrate: null,
      miningThreads: currentMiningThreads,
      miningStatus: currentMiningStatus,
      powerWatts: null,
    };
  }
}
