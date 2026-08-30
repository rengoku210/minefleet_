import type { MiningStatus } from '@minefleet/shared-types';

/** Abstract mining backend interface - all mining implementations must implement this */
export interface MiningBackend {
  /** Unique backend identifier */
  readonly name: string;

  /** Start mining */
  start(): Promise<void>;

  /** Stop mining completely */
  stop(): Promise<void>;

  /** Pause mining (can be resumed) */
  pause(): Promise<void>;

  /** Resume mining after pause */
  resume(): Promise<void>;

  /** Get current mining status */
  getStatus(): MiningStatus;

  /** Get current hashrate in H/s */
  getHashrate(): number | null;

  /** Apply resource limits */
  applyLimits(limits: MiningLimits): Promise<void>;

  /** Check if this backend is supported on current hardware */
  isSupported(): Promise<boolean>;

  /** Clean up resources */
  destroy(): Promise<void>;
}

export interface MiningLimits {
  cpuLimitPercent: number;
  maxThreads: number | null;
  gpuEnabled: boolean;
}
