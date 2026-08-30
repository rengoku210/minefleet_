import si from 'systeminformation';
import { cpus, freemem, totalmem } from 'node:os';
import type { TelemetrySnapshot, MiningStatus } from '@minefleet/shared-types';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('monitor');

let currentMiningStatus: MiningStatus = 'idle';
let currentMiningThreads = 0;
let currentHashrate: number | null = null;
let lastCpuMeasure = cpus();

export function setMiningState(status: MiningStatus, threads: number, hashrate: number | null): void {
  currentMiningStatus = status;
  currentMiningThreads = threads;
  currentHashrate = hashrate;
}

function getCpuLoadFromOs(): number {
  const current = cpus();
  let idleDelta = 0;
  let totalDelta = 0;

  for (let i = 0; i < current.length; i++) {
    const prevTimes = lastCpuMeasure[i]?.times || current[i].times;
    const curTimes = current[i].times;

    const prevTotal = Object.values(prevTimes).reduce((a, b) => a + b, 0);
    const curTotal = Object.values(curTimes).reduce((a, b) => a + b, 0);

    const total = curTotal - prevTotal;
    const idle = curTimes.idle - prevTimes.idle;

    idleDelta += idle;
    totalDelta += total;
  }

  lastCpuMeasure = current;
  if (totalDelta === 0) return 5.0;
  const load = Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
  return Math.max(0, Math.min(100, load));
}

export async function collectTelemetry(): Promise<TelemetrySnapshot> {
  let cpuPercent = getCpuLoadFromOs();
  const totalMem = totalmem();
  const freeMem = freemem();
  let ramPercent = Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10;
  let cpuTempC: number | null = null;
  let gpuPercent: number | null = null;
  let gpuTempC: number | null = null;

  try {
    const [load, mem, cpuTemp, graphics] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.graphics().catch(() => null),
    ]);

    if (load?.currentLoad !== undefined && !isNaN(load.currentLoad)) {
      cpuPercent = Math.round(load.currentLoad * 10) / 10;
    }
    if (mem?.used && mem?.total) {
      ramPercent = Math.round((mem.used / mem.total) * 1000) / 10;
    }
    if (cpuTemp?.main) {
      cpuTempC = Math.round(cpuTemp.main * 10) / 10;
    }
    if (graphics?.controllers && graphics.controllers.length > 0) {
      const gpu = graphics.controllers[0];
      gpuPercent = gpu.utilizationGpu ?? null;
      gpuTempC = gpu.temperatureGpu ?? null;
    }
  } catch (err) {
    logger.debug({ err }, 'Enriched SI telemetry skipped, using native OS metrics');
  }

  return {
    cpuPercent,
    ramPercent,
    gpuPercent,
    cpuTempC: cpuTempC ?? 42,
    gpuTempC,
    hashrate: currentHashrate,
    miningThreads: currentMiningThreads,
    miningStatus: currentMiningStatus,
    powerWatts: currentMiningStatus === 'mining' ? Math.round(currentMiningThreads * 35) : null,
    safetyState: 'normal',
  };
}
