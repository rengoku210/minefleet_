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
  let topProcesses: Array<{ name: string; cpuPercent: number; ramBytes: number; pid?: number }> = [];

  try {
    const [load, mem, cpuTemp, graphics, procs] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.graphics().catch(() => null),
      si.processes().catch(() => null),
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
    if (procs?.list && procs.list.length > 0) {
      topProcesses = procs.list
        .filter((p: any) => p.name && p.cpu > 0.1)
        .sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0))
        .slice(0, 8)
        .map((p: any) => ({
          name: p.name,
          cpuPercent: Math.round(p.cpu * 10) / 10,
          ramBytes: p.memRss || Math.round((p.mem || 0) * 1024 * 1024),
          pid: p.pid,
        }));
    }
  } catch (err) {
    logger.debug({ err }, 'Enriched SI telemetry skipped, using native OS metrics');
  }

  const minefleetCpuPercent = currentMiningStatus === 'mining'
    ? Math.min(cpuPercent, Math.round(currentMiningThreads * 8.5 * 10) / 10)
    : 0.2;
  const otherCpuPercent = Math.max(0, Math.round((cpuPercent - minefleetCpuPercent) * 10) / 10);

  let workloadLevel: 'light' | 'normal' | 'heavy' | 'critical' = 'light';
  if (otherCpuPercent >= 75) workloadLevel = 'critical';
  else if (otherCpuPercent >= 45) workloadLevel = 'heavy';
  else if (otherCpuPercent >= 15) workloadLevel = 'normal';

  return {
    cpuPercent,
    ramPercent,
    ramTotalBytes: totalMem,
    ramUsedBytes: totalMem - freeMem,
    ramAvailableBytes: freeMem,
    gpuPercent,
    cpuTempC: cpuTempC ?? null,
    gpuTempC,
    hashrate: currentHashrate,
    miningThreads: currentMiningThreads,
    miningStatus: currentMiningStatus,
    powerWatts: currentMiningStatus === 'mining' ? Math.round(currentMiningThreads * 35) : null,
    workloadLevel,
    minefleetCpuPercent,
    otherCpuPercent,
    topProcesses,
    uptimeSeconds: Math.round(process.uptime()),
  };
}
