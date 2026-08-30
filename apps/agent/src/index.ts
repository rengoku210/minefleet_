import { loadLocalConfig, getControllerUrl, getAgentVersion } from './config.js';
import { AgentHttpClient } from './connection/http-client.js';
import { MiningManager } from './mining/manager.js';
import { ThermalProtection } from './safety/thermal.js';
import { WorkloadProtection } from './safety/workload.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info({ version: getAgentVersion() }, 'MineFleet Agent starting');

  const localConfig = loadLocalConfig();
  if (!localConfig) {
    logger.fatal('No local configuration found. Please run the installer first.');
    process.exit(1);
  }

  const controllerUrl = getControllerUrl();
  logger.info({ controllerUrl, machineUid: localConfig.machineUid }, 'Configuration loaded');

  // Initialize components
  const miningManager = new MiningManager();
  const thermalProtection = new ThermalProtection();
  const workloadProtection = new WorkloadProtection();
  const httpClient = new AgentHttpClient(controllerUrl, miningManager);

  // Apply last known safe config if available
  if (localConfig.lastConfig) {
    logger.info({ version: localConfig.lastConfigVersion }, 'Applying last known safe config');
    await miningManager.applyConfig(localConfig.lastConfig);
    thermalProtection.setConfig(localConfig.lastConfig);
    workloadProtection.setConfig(localConfig.lastConfig);
  }

  // Wire up thermal protection
  thermalProtection.setOnAction(async (action, temp) => {
    logger.info({ action, temp }, 'Thermal protection action');
    if (action === 'pause') {
      await miningManager.pause();
    } else if (action === 'reduce') {
      const config = localConfig.lastConfig;
      if (config) {
        await miningManager.applyConfig({ ...config, cpuLimitPercent: Math.floor(config.cpuLimitPercent / 2) });
      }
    } else {
      if (localConfig.lastConfig) {
        await miningManager.applyConfig(localConfig.lastConfig);
      }
      await miningManager.resume();
    }
  });

  // Wire up workload protection
  workloadProtection.setOnAction(async (action, cpu) => {
    logger.info({ action, cpu }, 'Workload protection action');
    if (action === 'pause') {
      await miningManager.pause();
    } else if (action === 'reduce') {
      const config = localConfig.lastConfig;
      if (config) {
        await miningManager.applyConfig({ ...config, cpuLimitPercent: Math.floor(config.cpuLimitPercent / 2) });
      }
    } else {
      if (localConfig.lastConfig) {
        await miningManager.applyConfig(localConfig.lastConfig);
      }
      await miningManager.resume();
    }
  });

  // Start background tasks
  thermalProtection.start();
  workloadProtection.start();
  await httpClient.start(15000); // 15s interval

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Agent shutting down');
    thermalProtection.stop();
    workloadProtection.stop();
    httpClient.stop();
    await miningManager.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Agent failed to start');
  process.exit(1);
});
